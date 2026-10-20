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
  // a module whose functions read its globals, a def it calls, a builtin it calls
  '/site/patchme.py': [
    'k = 1',
    'def helper(x): return "orig%d" % x',
    'def h(x): return helper(x)',
    'def n(s): return len(s)',
    'def getk(): return k',
    'def setk(v):',
    '    global k',
    '    k = v',
    'def uses_extra(): return extra',
    'class Thing:',
    '    def go(self): return helper(1) + str(k)',
  ].join('\n'),
  '/site/reloadme.py': [
    'try:',
    '    count += 1',
    'except NameError:',
    '    count = 1',
    'k = 1',
    'def f(): return "old" + str(k)',
    'def gone(): return "gone" + str(k)',
  ].join('\n'),
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
  '/site/badsyntax.py': 'x = (1,\n',
  // a free name nothing binds: NameError when read, not None — at module level, in a function, in
  // a default; a builtin and a module dunder still read
  '/site/freenames.py': [
    'out = []',
    'try:',
    '    out.append(not_defined)',
    'except NameError as e:',
    '    out.append(str(e))',
    'def f():',
    '    return also_not_defined',
    'def g():',
    '    def h(v=1, x=nor_this):',
    '        pass',
    'def ok():',
    '    return len("ab"), __name__',
  ].join('\n'),
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

  it('a module reading a name nothing defines raises NameError', async () => {
    const out = await runBoth([
      'import freenames',
      'print(freenames.out, freenames.ok())',
      'for fn in (freenames.f, freenames.g):',
      '    try:',
      '        fn()',
      '    except NameError as e:',
      '        print(e)',
    ].join('\n'));
    assert.equal(out, ["[\"name 'not_defined' is not defined\"] (2, 'freenames')", "name 'also_not_defined' is not defined", "name 'nor_this' is not defined", ''].join('\n'));
  });

  it('a module or exec string compiled before: reused, each run its own objects', async () => {
    const out = await runBoth([
      'import money',
      'doc1 = money.__doc__',
      'C1 = money.M',
      'del sys.modules["money"]',
      'import money',
      'print(money.M is C1, money.__doc__ == doc1, money.M(5) + money.M(1))',
      'ns1, ns2 = {"k": 1}, {"k": 3}',
      'exec("def g(x):\\n    return x * k", ns1)',
      'exec("def g(x):\\n    return x * k", ns2)',
      'print(ns1["g"](10), ns2["g"](10), ns1["g"] is ns2["g"])',
      'for _ in range(2):',
      '    try:',
      '        import badsyntax',
      '    except SyntaxError as e:',
      '        print("SyntaxError")',
    ].join('\n'));
    assert.equal(out, ['False True M(6)', '10 30 False', 'SyntaxError', 'SyntaxError', ''].join('\n'));
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

  // a module attribute written from outside is what the module's functions see (CPython: the
  // module __dict__ is their globals) — mock.patch, setattr, a builtin patched per module
  it('monkeypatching a module reaches its functions', async () => {
    const out = await runBoth([
      'import patchme as pm',
      'from unittest import mock',
      'with mock.patch("patchme.helper") as m:',
      '    m.return_value = "mocked"',
      '    print(pm.h(2), pm.Thing().go(), m.call_args.args)',
      'print(pm.h(2))',
      'with mock.patch.object(pm, "helper", lambda x: "lam%d" % x):',
      '    print(pm.Thing().go())',
      'print(pm.Thing().go())',
      'with mock.patch("patchme.len", create=True, return_value=99):',
      '    print(pm.n("abc"))',
      'print(pm.n("abc"), hasattr(pm, "len"))',
      'setattr(pm, "k", 7)',
      'print(pm.getk())',
      'pm.setk(8)',
      'print(pm.k, pm.getk())',
      'pm.extra = "made"',
      'print(pm.uses_extra())',
      'del pm.extra',
      'try:',
      '    pm.uses_extra()',
      'except NameError:',
      '    print("NameError")',
    ].join('\n'));
    // (CPython 3.13 prints exactly this)
    assert.equal(out, ['mocked mocked1 (1,)', 'orig2', 'lam11', 'orig11', '99', '3 False', '7', '8 8', 'made', 'NameError', ''].join('\n'));
  });

  // importlib.reload runs the module's code again in the module object everyone holds
  it('reload re-runs a module in the same module object', async () => {
    const out = await runBoth([
      'import importlib, sys',
      'import reloadme as r0',
      'f0, g0 = r0.f, r0.gone',
      'def put(src):',
      '    with open(r0.__file__, "w") as fh:',
      '        fh.write(src)',
      'put("try:\\n    count += 1\\nexcept NameError:\\n    count = 1\\nk = 2\\ndef f(): return \'new\' + str(k)\\n")',
      'r1 = importlib.reload(r0)',
      'print(r1 is r0, sys.modules["reloadme"] is r0, r0.count)',
      'print(r0.f(), f0(), r0.gone(), g0 is r0.gone)',
      'r0.k = 9',
      'print(r0.f(), f0(), g0())',
      'put("k = 3\\nraise ValueError(\'half\')\\n")',
      'try:',
      '    importlib.reload(r0)',
      'except ValueError as e:',
      '    print("ValueError", e)',
      'print(sys.modules["reloadme"] is r0, r0.k, r0.f(), f0())',
      'del sys.modules["reloadme"]',
      'try:',
      '    importlib.reload(r0)',
      'except ImportError as e:',
      '    print(type(e).__name__, e)',
    ].join('\n'));
    // (CPython 3.13 prints exactly this)
    assert.equal(out, ['True True 2', 'new2 old2 gone2 True', 'new9 old9 gone9', 'ValueError half', 'True 3 new3 old3',
      'ImportError module reloadme not in sys.modules', ''].join('\n'));
  });

  // a function exec defines reads its globals dict as it is when called, not as it was then — a
  // dict with a non-string key (a PyDict: every write seen) and a literal (a plain object: the
  // names it had when the code ran)
  it('exec namespaces: later writes reach the functions defined there', async () => {
    const out = await runBoth([
      'def probe(ns):',
      '    out = []',
      '    exec("def f(x): return x * k\\ndef g(): return f(2)", ns)',
      '    ns["k"] = 5',
      '    out.append(ns["f"](2))',
      '    ns.update(k=6)',
      '    out.append(ns["g"]())',
      '    ns["f"] = lambda x: "replaced"',
      '    out.append(ns["g"]())',
      '    del ns["f"]',
      '    try:',
      '        ns["g"]()',
      '    except NameError:',
      '        out.append("NameError")',
      '    exec("def f(x): return x + k", ns)',
      '    out.append(ns["g"]())',
      '    return out',
      'print(probe({0: None, "k": 1}))',
      'print(probe({"k": 1}))',
      'ns = {0: None, "k": 1}',
      'exec("def f(x): return x + k\\ndef n(s): return len(s)", ns)',
      'ns.pop("k")',
      'ns.setdefault("k", 100)',
      'r = [ns["f"](1)]',
      'dict.__setitem__(ns, "k", 200)',
      'r.append(ns["f"](1))',
      'ns["len"] = lambda s: -1',
      'r.append(ns["n"]("abc"))',
      'del ns["len"]',
      'r.append(ns["n"]("abc"))',
      'g, l = {0: None, "k": 1}, {}',
      'exec("def h(): return k", g, l)',
      'g["k"] = 9',
      'print(r, l["h"](), type(ns).__name__, ns == dict(ns))',
    ].join('\n'));
    // (CPython 3.13 prints exactly this)
    assert.equal(out, ["[10, 12, 'replaced', 'NameError', 8]", "[10, 12, 'replaced', 'NameError', 8]", '[101, 201, -1, 3] 9 dict True', ''].join('\n'));
  });
});
