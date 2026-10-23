// Tests for adder → AIR → JS transpilation path.
// Runs Python code through the transpile pipeline end-to-end and asserts output.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { adderParse } from '../ext/adder/src/parse.js';
import { lowerAdder, AirLowerError } from '../ext/adder/src/air-lower.js';
import { runPasses } from '../ext/air/src/passes.js';
import { emitJS } from '../ext/air/src/emit-js.js';
import { _py } from '../ext/adder/src/runtime.js';
import { adderBuiltins, pyStr } from '../ext/adder/src/builtins.js';
import { run as airRun } from '../ext/adder/src/air.js';
import { run as twRun } from '../ext/adder/src/runner.js';

async function runTranspile(code) {
  const output = [];
  // adderBuiltins' print already formats and adds newline; we're the raw sink
  const printFn = (text) => { output.push(text); return null; };
  const ast = adderParse(code);
  const air = lowerAdder(ast, code);
  runPasses(air);
  const importNames = [...air.imports];
  const js = emitJS(air, importNames, [], { hinted: false, cellId: 'test' });
  const builtins = adderBuiltins(printFn);
  const AF = Object.getPrototypeOf(async function(){}).constructor;
  const fn = new AF('_py', ...importNames, js);
  const args = importNames.map(n => builtins[n] !== undefined ? builtins[n] : undefined);
  const result = await fn(_py, ...args);
  return { result: result || {}, output: output.join('').trim() };
}

describe('adder transpile — arithmetic', () => {
  it('integer add', async () => {
    const r = await runTranspile('x = 1 + 2\nprint(x)');
    assert.equal(r.output, '3');
  });
  it('integer mul', async () => {
    const r = await runTranspile('x = 6 * 7\nprint(x)');
    assert.equal(r.output, '42');
  });
  it('float div', async () => {
    const r = await runTranspile('x = 10 / 4\nprint(x)');
    assert.equal(r.output, '2.5');
  });
  it('floor div', async () => {
    const r = await runTranspile('x = 10 // 3\nprint(x)');
    assert.equal(r.output, '3');
  });
  it('modulo', async () => {
    const r = await runTranspile('x = 10 % 3\nprint(x)');
    assert.equal(r.output, '1');
  });
  it('exponent', async () => {
    const r = await runTranspile('x = 2 ** 10\nprint(x)');
    assert.equal(r.output, '1024');
  });
  it('negative', async () => {
    const r = await runTranspile('x = -5\nprint(x)');
    assert.equal(r.output, '-5');
  });
  it('bitwise int and', async () => {
    const r = await runTranspile('print(0b1100 & 0b1010)');
    assert.equal(r.output, '8');
  });
  it('bitwise int or', async () => {
    const r = await runTranspile('print(0b1100 | 0b1010)');
    assert.equal(r.output, '14');
  });
  it('bitwise int xor', async () => {
    const r = await runTranspile('print(0b1100 ^ 0b1010)');
    assert.equal(r.output, '6');
  });
  it('bitwise & calls __and__ on objects', async () => {
    // Regression: lowerBinOp_ad fast-pathed `&` to native bitwise_and
    // unconditionally, which coerced sadpan's BooleanMask to 0 and
    // broke df[mask1 & mask2]. Now routes through _py.and_ which
    // checks for __and__ dunder before falling back to int bitwise.
    // Sanity: confirm the helper itself dispatches; the adder path
    // is exercised by example_adder_sadpan in the smoke sweep.
    const a = { __and__: (other) => `and-called:${a.v}&${other.v}`, v: 'a' };
    const b = { v: 'b' };
    assert.equal(_py.and_(a, b), 'and-called:a&b');
    // ints still fast-path
    assert.equal(_py.and_(0b1100, 0b1010), 8);
    assert.equal(_py.or_(0b1100, 0b1010), 14);
    assert.equal(_py.xor(0b1100, 0b1010), 6);
  });
});

describe('adder transpile — strings', () => {
  it('concat', async () => {
    const r = await runTranspile('x = "hello" + " " + "world"\nprint(x)');
    assert.equal(r.output, 'hello world');
  });
  it('repeat', async () => {
    const r = await runTranspile('x = "ab" * 3\nprint(x)');
    assert.equal(r.output, 'ababab');
  });
  it('len', async () => {
    const r = await runTranspile('print(len("hello"))');
    assert.equal(r.output, '5');
  });
  it('f-string', async () => {
    const r = await runTranspile('name = "world"\nprint(f"hello {name}!")');
    assert.equal(r.output, 'hello world!');
  });
  it('f-string with expression', async () => {
    const r = await runTranspile('x = 5\nprint(f"{x * 2}")');
    assert.equal(r.output, '10');
  });
  it('f-string with format spec', async () => {
    // adder parser emits formatSpec as a raw string (".2f"); lowerer must
    // handle that path, not just the JoinedStr-shaped one.
    const r = await runTranspile('x = 3.14159\nprint(f"{x:.2f}")');
    assert.equal(r.output, '3.14');
  });
});

describe('adder transpile — comparison and bool', () => {
  it('simple compare', async () => {
    const r = await runTranspile('print(5 > 3)');
    assert.equal(r.output, 'True');
  });
  it('chained compare', async () => {
    const r = await runTranspile('x = 10\nprint(5 < x < 15)');
    assert.equal(r.output, 'True');
  });
  it('and', async () => {
    const r = await runTranspile('print(True and False)');
    assert.equal(r.output, 'False');
  });
  it('or', async () => {
    const r = await runTranspile('print(True or False)');
    assert.equal(r.output, 'True');
  });
  it('not', async () => {
    const r = await runTranspile('print(not True)');
    assert.equal(r.output, 'False');
  });
});

describe('adder transpile — control flow', () => {
  it('if / else', async () => {
    const r = await runTranspile('x = 5\nif x > 3:\n    print("big")\nelse:\n    print("small")');
    assert.equal(r.output, 'big');
  });
  it('if / elif / else', async () => {
    const r = await runTranspile('x = 5\nif x > 10:\n    print("a")\nelif x > 3:\n    print("b")\nelse:\n    print("c")');
    assert.equal(r.output, 'b');
  });
  it('for loop', async () => {
    const r = await runTranspile('total = 0\nfor i in range(10):\n    total = total + i\nprint(total)');
    assert.equal(r.output, '45');
  });
  it('while loop', async () => {
    const r = await runTranspile('n = 5\nwhile n > 0:\n    n = n - 1\nprint(n)');
    assert.equal(r.output, '0');
  });
  it('break', async () => {
    const r = await runTranspile('for i in range(10):\n    if i == 3:\n        break\nprint(i)');
    assert.equal(r.output, '3');
  });
  it('continue', async () => {
    const r = await runTranspile('total = 0\nfor i in range(10):\n    if i % 2 == 0:\n        continue\n    total = total + i\nprint(total)');
    assert.equal(r.output, '25');
  });
});

describe('adder transpile — functions', () => {
  it('simple def', async () => {
    const r = await runTranspile('def add(a, b):\n    return a + b\nprint(add(3, 4))');
    assert.equal(r.output, '7');
  });
  it('recursive', async () => {
    const r = await runTranspile('def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nprint(fact(5))');
    assert.equal(r.output, '120');
  });
  it('lambda', async () => {
    const r = await runTranspile('sq = lambda x: x * x\nprint(sq(7))');
    assert.equal(r.output, '49');
  });
  it('closure', async () => {
    const r = await runTranspile('def make_adder(n):\n    return lambda x: x + n\nadd5 = make_adder(5)\nprint(add5(10))');
    assert.equal(r.output, '15');
  });
});

describe('adder transpile — collections', () => {
  it('list literal', async () => {
    const r = await runTranspile('x = [1, 2, 3]\nprint(x)');
    assert.equal(r.output, '[1, 2, 3]');
  });
  it('list indexing', async () => {
    const r = await runTranspile('x = [10, 20, 30]\nprint(x[1])');
    assert.equal(r.output, '20');
  });
  it('list negative index', async () => {
    const r = await runTranspile('x = [10, 20, 30]\nprint(x[-1])');
    assert.equal(r.output, '30');
  });
  it('list slice', async () => {
    const r = await runTranspile('x = [1, 2, 3, 4, 5]\nprint(x[1:4])');
    assert.equal(r.output, '[2, 3, 4]');
  });
  it('list comprehension', async () => {
    const r = await runTranspile('x = [i * 2 for i in range(5)]\nprint(x)');
    assert.equal(r.output, '[0, 2, 4, 6, 8]');
  });
  it('list comprehension with filter', async () => {
    const r = await runTranspile('x = [i for i in range(10) if i % 2 == 0]\nprint(x)');
    assert.equal(r.output, '[0, 2, 4, 6, 8]');
  });
  it('sum', async () => {
    const r = await runTranspile('print(sum([1, 2, 3, 4]))');
    assert.equal(r.output, '10');
  });
  it('dict with string keys', async () => {
    const r = await runTranspile('d = {"a": 1, "b": 2}\nprint(d["a"] + d["b"])');
    assert.equal(r.output, '3');
  });
});

describe('adder transpile — slice assignment', () => {
  it('replace same length', async () => {
    const r = await runTranspile('x = [10, 20, 30, 40]\nx[1:3] = [98, 99]\nprint(x)');
    assert.equal(r.output, '[10, 98, 99, 40]');
  });
  it('shrink', async () => {
    const r = await runTranspile('x = [10, 20, 30, 40]\nx[1:3] = [99]\nprint(x)');
    assert.equal(r.output, '[10, 99, 40]');
  });
  it('grow', async () => {
    const r = await runTranspile('x = [10, 20, 30, 40]\nx[1:3] = [98, 99, 100]\nprint(x)');
    assert.equal(r.output, '[10, 98, 99, 100, 40]');
  });
  it('full replace via x[:]', async () => {
    const r = await runTranspile('x = [10, 20, 30]\nx[:] = [1, 2, 3, 4]\nprint(x)');
    assert.equal(r.output, '[1, 2, 3, 4]');
  });
  it('extended step', async () => {
    const r = await runTranspile('x = [10, 20, 30, 40, 50]\nx[::2] = [98, 99, 100]\nprint(x)');
    assert.equal(r.output, '[98, 20, 99, 40, 100]');
  });
  it('fannkuch reverse-in-place idiom', async () => {
    const r = await runTranspile('p = [1, 2, 3, 4, 5]\np[:3] = p[2::-1]\nprint(p)');
    assert.equal(r.output, '[3, 2, 1, 4, 5]');
  });
  it('extended slice size mismatch raises ValueError', async () => {
    await assert.rejects(
      () => runTranspile('x = [10, 20, 30, 40, 50]\nx[::2] = [98, 99]'),
      (e) => e.pyType === 'ValueError',
    );
  });
  it('string slice assign raises TypeError', async () => {
    await assert.rejects(
      () => runTranspile('s = "hi"\ns[0:1] = "x"'),
      (e) => e.pyType === 'TypeError',
    );
  });
  it('augmented slice += list', async () => {
    const r = await runTranspile('x = [10, 20, 30, 40]\nx[1:3] += [98]\nprint(x)');
    assert.equal(r.output, '[10, 20, 30, 98, 40]');
  });
  it('augmented slice *= int (list repetition)', async () => {
    const r = await runTranspile('x = [10, 20, 30, 40]\nx[1:3] *= 2\nprint(x)');
    assert.equal(r.output, '[10, 20, 30, 20, 30, 40]');
  });
  it('augmented slice x[:] += [..]', async () => {
    const r = await runTranspile('x = [10, 20, 30]\nx[:] += [40, 50]\nprint(x)');
    assert.equal(r.output, '[10, 20, 30, 40, 50]');
  });
});

describe('adder transpile — method-call PIC', () => {
  it('class instance method via the fused callMethod path', async () => {
    const r = await runTranspile(`
class C:
    def __init__(self, n):
        self.n = n
    def double(self):
        return self.n * 2

c = C(7)
print(c.double())
`);
    assert.equal(r.output, '14');
  });

  it('inherited method via callMethod (subclass instance)', async () => {
    const r = await runTranspile(`
class Base:
    def greet(self, who):
        return "hi " + who

class Child(Base):
    pass

c = Child()
print(c.greet("there"))
`);
    assert.equal(r.output, 'hi there');
  });

  it('polymorphic call site sees 5+ types and still produces correct results', async () => {
    // Exercises the FIFO eviction path: the same call site walks through
    // five distinct receiver types, exceeding the 4-slot PIC capacity.
    const r = await runTranspile(`
class A:
    def label(self): return "A"
class B:
    def label(self): return "B"
class C:
    def label(self): return "C"
class D:
    def label(self): return "D"
class E:
    def label(self): return "E"

# Same call site, 5 different types, repeated 3 times
out = []
for _ in range(3):
    for obj in [A(), B(), C(), D(), E()]:
        out.append(obj.label())
print(out)
`);
    assert.equal(
      r.output,
      "['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D', 'E']",
    );
  });

  it('method call with keyword arguments', async () => {
    const r = await runTranspile(`
class C:
    def add(self, a, b=10):
        return a + b
c = C()
print(c.add(5))
print(c.add(5, b=20))
print(c.add(a=3, b=4))
`);
    assert.equal(r.output, '15\n25\n7');
  });
});

describe('adder transpile — list subclass + class-attr assign', () => {
  it('class Sub(list): pass — instance is array-like', async () => {
    const r = await runTranspile(`
class OC(list):
    pass

c = OC()
c.append(1)
c.append(2)
print([len(c), list(c)])
`);
    assert.equal(r.output, '[2, [1, 2]]');
  });

  it('class-attr assignment after class body', async () => {
    // deltablue idiom: declare placeholders, then assign instances later.
    const r = await runTranspile(`
class Strength:
    REQUIRED = None

    def __init__(self, s):
        self.strength = s

Strength.REQUIRED = Strength(7)
print(Strength.REQUIRED.strength)
`);
    assert.equal(r.output, '7');
  });
});

describe('adder transpile — async generator iteration', () => {
  it('iterate gen that yields awaited values', async () => {
    // Generator body uses `tuple(genexp)` which materialises async,
    // so the gen becomes an `async function*`. Caller iterates via
    // `for vec in gen()` — must materialise the async iter before
    // for-of. Mirrors the nqueens permutations pattern.
    const r = await runTranspile(`
def gen():
    for i in range(3):
        yield tuple(j for j in range(i + 1))

out = []
for vec in gen():
    out.append(vec)
print(out)
`);
    assert.equal(r.output, '[(0,), (0, 1), (0, 1, 2)]');
  });

  it('nested gen-in-gen with chained-eq inside (nqueens-shaped)', async () => {
    const r = await runTranspile(`
def perms(n):
    for i in range(n):
        yield (i,)

def filter_perms(n):
    for vec in perms(n):
        if vec[0] == vec[0] == vec[0]:
            yield vec

print(len(list(filter_perms(5))))
`);
    assert.equal(r.output, '5');
  });
});

describe('adder transpile — loop/else clauses', () => {
  it('while/else, no break: else runs', async () => {
    const r = await runTranspile('i = 0\nwhile i < 3:\n    i += 1\nelse:\n    print("ran")');
    assert.equal(r.output, 'ran');
  });
  it('while/else with break: else skipped', async () => {
    const r = await runTranspile('i = 0\nwhile i < 10:\n    if i == 3:\n        print("broke")\n        break\n    i += 1\nelse:\n    print("else")');
    assert.equal(r.output, 'broke');
  });
  it('for/else, no break: else runs', async () => {
    const r = await runTranspile('for i in range(5):\n    pass\nelse:\n    print("done")');
    assert.equal(r.output, 'done');
  });
  it('for/else with break: else skipped', async () => {
    const r = await runTranspile('for i in range(10):\n    if i == 4:\n        print("stop")\n        break\nelse:\n    print("else")');
    assert.equal(r.output, 'stop');
  });
  it('nested: inner break does not fire outer else', async () => {
    const r = await runTranspile(`
log = []
for outer in range(2):
    for inner in range(5):
        if inner == 2:
            log.append("inner-break")
            break
    log.append("outer-iter")
else:
    log.append("outer-else")
print(log)
`);
    assert.equal(r.output, "['inner-break', 'outer-iter', 'inner-break', 'outer-iter', 'outer-else']");
  });
});

describe('adder transpile — slice deletion', () => {
  it('simple delete', async () => {
    const r = await runTranspile('x = [10, 20, 30, 40]\ndel x[1:3]\nprint(x)');
    assert.equal(r.output, '[10, 40]');
  });
  it('extended step delete', async () => {
    const r = await runTranspile('x = [10, 20, 30, 40, 50]\ndel x[::2]\nprint(x)');
    assert.equal(r.output, '[20, 40]');
  });
  it('delete all via x[:]', async () => {
    const r = await runTranspile('x = [1, 2, 3]\ndel x[:]\nprint(x)');
    assert.equal(r.output, '[]');
  });
});

describe('adder transpile — full coverage', () => {
  // Most Python features now lower successfully. This suite runs them end-to-end.
  it('default arguments', async () => {
    const r = await runTranspile('def greet(name, greeting="hello"):\n    return greeting + " " + name\nprint(greet("world"))\nprint(greet("world", greeting="hi"))');
    assert.equal(r.output, 'hello world\nhi world');
  });
  it('*args', async () => {
    const r = await runTranspile('def sum_all(*nums):\n    t = 0\n    for n in nums:\n        t = t + n\n    return t\nprint(sum_all(1, 2, 3, 4))');
    assert.equal(r.output, '10');
  });
  it('**kwargs', async () => {
    const r = await runTranspile('def greet(**kw):\n    return kw["greeting"] + " " + kw["name"]\nprint(greet(greeting="hi", name="friend"))');
    assert.equal(r.output, 'hi friend');
  });
  it('decorator', async () => {
    const r = await runTranspile('def twice(fn):\n    def w(x):\n        return fn(fn(x))\n    return w\n@twice\ndef inc(x):\n    return x + 1\nprint(inc(5))');
    assert.equal(r.output, '7');
  });
  it('tuple destructuring in for', async () => {
    const r = await runTranspile('pairs = [(1, 2), (3, 4)]\ntotal = 0\nfor a, b in pairs:\n    total = total + a + b\nprint(total)');
    assert.equal(r.output, '10');
  });
  it('set literal', async () => {
    const r = await runTranspile('s = {1, 2, 3, 2, 1}\nprint(len(s))');
    assert.equal(r.output, '3');
  });
  it('dict comprehension', async () => {
    const r = await runTranspile('d = {i: i*i for i in range(4)}\nprint(d[3])');
    assert.equal(r.output, '9');
  });
  it('set comprehension', async () => {
    const r = await runTranspile('s = {i % 3 for i in range(10)}\nprint(len(s))');
    assert.equal(r.output, '3');
  });
  it('try/except basic', async () => {
    const r = await runTranspile('try:\n    x = 1 / 0\nexcept:\n    x = -1\nprint(x)');
    assert.equal(r.output, '-1');
  });
  it('try/except with type', async () => {
    const r = await runTranspile('try:\n    x = 1 / 0\nexcept ZeroDivisionError:\n    x = "zdiv"\nprint(x)');
    assert.equal(r.output, 'zdiv');
  });
  it('try/finally', async () => {
    const r = await runTranspile('log = []\ntry:\n    log.append("a")\nfinally:\n    log.append("b")\nprint(log)');
    assert.equal(r.output, "['a', 'b']");
  });
  it('class simple', async () => {
    const r = await runTranspile('class Point:\n    def __init__(self, x, y):\n        self.x = x\n        self.y = y\n    def dist_sq(self):\n        return self.x * self.x + self.y * self.y\np = Point(3, 4)\nprint(p.dist_sq())');
    assert.equal(r.output, '25');
  });
  it('class inheritance', async () => {
    const r = await runTranspile('class Animal:\n    def speak(self):\n        return "noise"\nclass Dog(Animal):\n    def speak(self):\n        return "woof"\nprint(Dog().speak())');
    assert.equal(r.output, 'woof');
  });
  it('yield generator', async () => {
    const r = await runTranspile('def counter(n):\n    i = 0\n    while i < n:\n        yield i\n        i = i + 1\nprint(list(counter(3)))');
    assert.equal(r.output, '[0, 1, 2]');
  });
  it('starred call', async () => {
    const r = await runTranspile('def add3(a, b, c):\n    return a + b + c\nargs = [1, 2, 3]\nprint(add3(*args))');
    assert.equal(r.output, '6');
  });
  it('starred unpacking', async () => {
    const r = await runTranspile('a, *rest = [1, 2, 3, 4]\nprint(a)\nprint(rest)');
    assert.equal(r.output, '1\n[2, 3, 4]');
  });
  it('list += extends in place (__iadd__ semantics)', async () => {
    // Python: `lst += [..]` calls lst.__iadd__, which mutates in place.
    // Another reference to the same list should observe the update.
    const r = await runTranspile(
      'a = [1, 2]\nb = a\na += [3, 4]\nprint(a)\nprint(b)\nprint(a is b)'
    );
    assert.equal(r.output, '[1, 2, 3, 4]\n[1, 2, 3, 4]\nTrue');
  });
  it('custom __iadd__ dispatches', async () => {
    const r = await runTranspile(
      'class Bag:\n    def __init__(self):\n        self.n = 0\n    def __iadd__(self, x):\n        self.n += x\n        return self\nb = Bag()\nb += 5\nb += 3\nprint(b.n)'
    );
    assert.equal(r.output, '8');
  });
  it('int += rebinds (immutable fallback)', async () => {
    const r = await runTranspile('x = 5\nx += 3\nprint(x)');
    assert.equal(r.output, '8');
  });
  it('with statement: normal exit calls __exit__(None,None,None)', async () => {
    const r = await runTranspile(
      'class CM:\n    def __enter__(self):\n        print("enter")\n        return self\n    def __exit__(self, t, e, tb):\n        print("exit", t is None, e is None)\nwith CM():\n    print("body")'
    );
    assert.equal(r.output, 'enter\nbody\nexit True True');
  });
  it('with statement: __exit__ returning True suppresses exception', async () => {
    const r = await runTranspile(
      'class CM:\n    def __enter__(self):\n        return self\n    def __exit__(self, t, e, tb):\n        print("got", e)\n        return True\nwith CM():\n    raise ValueError("boom")\nprint("after")'
    );
    assert.ok(/got/.test(r.output));
    assert.ok(/after/.test(r.output));
  });
  it('with statement: __exit__ returning False re-raises', async () => {
    let threw = false;
    try {
      await runTranspile(
        'class CM:\n    def __enter__(self):\n        return self\n    def __exit__(self, t, e, tb):\n        return False\nwith CM():\n    raise ValueError("boom")'
      );
    } catch (e) {
      threw = true;
      assert.ok(/boom/.test(e.message || e.pyMessage || ''));
    }
    assert.ok(threw, 'expected exception to re-raise');
  });
});

describe('adder transpile — sync-builtin shadowing (audit 2026-06-01)', () => {
  it('a genuinely-async def shadowing a known-sync builtin is still awaited', async () => {
    // Regression: KNOWN_SYNC_BUILTINS (e.g. `abs`) was seeded into
    // syncFunctions unconditionally, so a user-defined `abs` that's genuinely
    // async (truly awaits inside) got called WITHOUT await → its Promise leaked
    // as the value and `r + 1` then errored ("unsupported operand object/int").
    // The seed now skips names the user shadowed (in ctx.defines), so the
    // shadow stays async and the call awaits. NB the shadow must really await —
    // a no-await `async def` is correctly downgraded to a sync fn either way.
    // (Since coroutines are lazy, `abs(5)` alone is a coroutine object, as in CPython: the
    // program awaits it.)
    const r = await runTranspile(
      'async def helper():\n'
      + '    return 100\n'
      + 'async def abs(x):\n'
      + '    h = await helper()\n'
      + '    return x + h\n'
      + 'r = await abs(5)\n'
      + 'print(r + 1)\n');
    assert.equal(r.output, '106');
  });
  it('calling an async def makes a coroutine object; gather runs coroutines together', async () => {
    const r = await runTranspile(
      'import asyncio\n'
      + 'log = []\n'
      + 'async def w(n, d):\n'
      + '    log.append("start " + n)\n'
      + '    await asyncio.sleep(d)\n'
      + '    log.append("end " + n)\n'
      + '    return n\n'
      + 'c = w("x", 0)\n'
      + 'print(type(c).__name__, log)\n'
      + 'c.close()\n'
      + 'print(await asyncio.gather(w("a", 0.04), w("b", 0.01)), log)\n');
    assert.equal(r.output, "coroutine []\n['a', 'b'] ['start a', 'start b', 'end b', 'end a']");
  });
  it('a method call site sees methods patched / deleted after its first call (type versions)', async () => {
    const r = await runTranspile("class A:\n    def m(self): return 'A'\nclass B(A):\n    pass\nclass C(A):\n    def m(self): return 'C'\nclass Mixin:\n    def m(self): return 'Mixin'\ndef call(o): return o.m()\na, b, c = A(), B(), C()\nlog = []\ndef snap(): log.append(','.join(call(x) for x in (a, b, c)))\nsnap()\nA.m = lambda self: 'A2'\nsnap()\nB.m = lambda self: 'B'\nsnap()\ndel B.m\nsnap()\ndel C.m\nsnap()\nB.__bases__ = (Mixin, A)\nsnap()\na.m = lambda: 'own'\nsnap()\nprint(log)");
    assert.equal(r.output, "['A,A,C', 'A2,A2,C', 'A2,B,C', 'A2,A2,C', 'A2,A2,A2', 'A2,Mixin,A2', 'own,Mixin,A2']");
  });
  it('assigning __defaults__ / __kwdefaults__ reaches the compiled function\'s calls', async () => {
    const r = await runTranspile("def f(a, b=2, *, c=3): return (a, b, c)\nlog = [f(1)]\nf.__defaults__ = (20,)\nf.__kwdefaults__ = {'c': 30}\nlog.append(f(1))\nf.__defaults__ = (10, 20)\nlog.append(f())\nf.__kwdefaults__['c'] = 99\nlog.append(f())\ndel f.__kwdefaults__['c']\ntry:\n    f()\nexcept TypeError as e:\n    log.append(str(e))\ndef g(x, y): return x + y\ng.__defaults__ = (100,)\nlog.append(g(1))\nclass P:\n    def m(self, k=1): return k\nP.m.__defaults__ = (42,)\nlog.append(P().m())\nprint(log)");
    assert.equal(r.output, "[(1, 2, 3), (1, 20, 30), (10, 20, 30), (10, 20, 99), \"f() missing 1 required keyword-only argument: 'c'\", 101, 42]");
  });
  it('a compiled lambda has live defaults and keyword-only parameters (namedtuple\'s __new__)', async () => {
    const r = await runTranspile("f = lambda x, y=2, *, z=3: (x, y, z)\nnew = lambda _cls, x, y: (_cls, x, y)\nnew.__defaults__ = (0,)\nprint(f.__defaults__, f.__kwdefaults__, f(1, z=4), new('C', 1))");
    assert.equal(r.output, "(2,) {'z': 3} (1, 2, 4) ('C', 1, 0)");
  });
  it('yield from a user iterable in a sync twin; dict.fromkeys / tuple.__new__ over user and async sources; classmethod.__func__', async () => {
    const r = await runTranspile("class M:\n    def __iter__(self):\n        d = {}\n        for m in map(dict.fromkeys, [['a'], ['b']]):\n            d |= m\n        return iter(d)\nclass KV:\n    def __init__(self, m): self._m = m\n    def __iter__(self):\n        yield from self._m\nclass T(tuple):\n    pass\ncm = classmethod(len)\nprint(list(KV(M())), dict.fromkeys(KV(M())), tuple.__new__(T, map(str, [1, 2])), type(tuple.__new__(T, (1,))).__name__, cm.__func__ is len)");
    assert.equal(r.output, "['a', 'b'] {'a': None, 'b': None} ('1', '2') T True");
  });
  it('an unshadowed known-sync builtin still skips the await (fast path intact)', async () => {
    const r = await runTranspile('print(len([1, 2, 3, 4]))');
    assert.equal(r.output, '4');
  });
});

// Regression: a sync lambda/function handed to a SYNCHRONOUS JS consumer (Array.map,
// sort comparators, sadpan Series.apply) must be callable synchronously — i.e. emitted
// as a plain `function`, not `async function`. Before the fix, lowerLambda hardcoded
// is_async:true and nested defs were never sync-classified, so JS callers got Promises
// (this is what made `err.apply(lambda v: v**2).mean()` return NaN/null in the GSLIB
// estimation example). The lambda/function only stays async when its body truly awaits.
describe('sync lambda/function as a synchronous JS callback (FFI)', () => {
  const mapmean = (arr, fn) => { const m = arr.map(fn); return m.reduce((a, b) => a + b, 0) / m.length; };
  const callSync = (fn) => fn(3); // JS invokes the adder callable synchronously

  it('a sync lambda returns a value (not a Promise) when JS calls it', async () => {
    const r = await airRun('out = callSync(lambda v: v ** 2)\n', { globals: { callSync } });
    assert.equal(r.out, 9);
  });

  it('a sync lambda works as an Array.map callback', async () => {
    const r = await airRun('out = mapmean([1, 2, 3], lambda v: v ** 2)\n', { globals: { mapmean } });
    assert.equal(r.out, 14 / 3);
  });

  it('a sync nested function works as a JS callback', async () => {
    const r = await airRun('def sq(v):\n    return v * v\nout = mapmean([1, 2, 3, 4], sq)\n', { globals: { mapmean } });
    assert.equal(r.out, 7.5);
  });
});

// Regression: `import <name>` lazy-loads an INSTALLED auditable extension via the
// window resolver hook (auditable sets window._auditableResolveModule). This is what
// makes adder first-class — `import plt` resolves the bundled @gcu/plot with no
// bootstrap `load()` cell. The hook fires after adder's own resolvers miss, on BOTH the
// AIR transpile path and the tree-walker. Standalone-safe when the hook is absent.
describe('adder import lazy-loads installed extensions via the resolver hook', () => {
  for (const [label, run] of [['AIR', airRun], ['tree-walker', twRun]]) {
    it(`import <name> resolves through window._auditableResolveModule (${label})`, async () => {
      const prev = globalThis.window;
      let asked = null;
      globalThis.window = {
        _auditableResolveModule: async (n) => { asked = n; return n === 'plt' ? { area: (r) => 3 * r * r } : null; },
      };
      try {
        const r = await run('import plt\nout = plt.area(2)\n');
        assert.equal(r.out, 12);
        assert.equal(asked, 'plt');
      } finally {
        if (prev === undefined) delete globalThis.window; else globalThis.window = prev;
      }
    });
  }

  it('is standalone-safe: no hook → ModuleNotFoundError, not a crash', async () => {
    const prev = globalThis.window;
    if (prev !== undefined) delete globalThis.window;
    try {
      await assert.rejects(() => airRun('import definitely_not_a_real_module_xyz\n'), /ModuleNotFound|No module named/);
    } finally {
      if (prev !== undefined) globalThis.window = prev;
    }
  });
});

// Python annotations are not types unless the module promises they are true
// (`from __adder__ import trust_annotations`); AIR's own hint names (i32, f64, …) always are
describe('adder transpile — annotations and __adder__ flags', () => {
  const emit = (src) => {
    const air = lowerAdder(adderParse(src), src);
    runPasses(air);
    return emitJS(air, ['_py', ...air.imports], [], { hinted: false });   // adder's emission
  };
  const fib = 'def fib(n: int) -> int:\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n';
  it('a Python int annotation is not a type: s * 2 still doubles a str', async () => {
    const src = 'def g(s: int):\n    return s * 2\nr = g("ab"), g(3), g(2**60)\n';
    for (const run of [airRun, twRun]) {
      const r = await run(src);
      assert.equal(r.r[0], 'abab');
      assert.equal(r.r[1], 6);
      assert.equal(r.r[2], 2n ** 61n);
    }
    assert.match(emit(fib), /_py\.sub\)\(n, 1\)/);
  });
  // (raw int arithmetic is a speculative region's fast body, each result range-checked: past
  // 2**53 the region runs its exact body — see the speculate-and-restart tests)
  it('trust_annotations types int as an int: raw checked ops, exact past 2**53', async () => {
    const src = 'from __adder__ import trust_annotations\n' + fib;
    const js = emit(src);
    assert.match(js, /let _\d+ = \(n - 1\);/);
    assert.doesNotMatch(js, /\| 0/);
    const dbl = 'from __adder__ import trust_annotations\ndef dbl(n: int) -> int:\n    return n + n\nr = dbl(2**40), dbl(-3), dbl(2**60), dbl(5)\n';
    assert.match(emit(dbl), /let _\d+ = \(n \+ n\);/);
    for (const run of [airRun, twRun]) assert.deepEqual([...(await run(dbl)).r], [2 ** 41, -6, 2n ** 61n, 10]);
  });
  it('AIR hint names are types without the flag (integer-valued: no | 0 in adder)', () => {
    const js = emit(fib.replace(/int/g, 'i32'));
    assert.match(js, /let _\d+ = \(n - 1\);/);
    assert.doesNotMatch(js, /\| 0/);
  });
  it('the flag goes after the docstring and __future__ imports; later is a SyntaxError', async () => {
    const ok = '"""doc"""\nfrom __future__ import annotations\nfrom __adder__ import trust_annotations, i32, f64\nr = i32, f64, trust_annotations\n';
    assert.deepEqual(adderParse(ok).adderFlags, ['trust_annotations']);
    for (const run of [airRun, twRun]) {
      const r = await run(ok);
      assert.equal(r.r[2], true);
    }
    assert.throws(() => adderParse('x = 1\nfrom __adder__ import trust_annotations\n'), /must occur at the beginning of the file \(line 2\)/);
    assert.equal(adderParse('x = 1\nfrom __adder__ import i32\n').adderFlags, undefined);
  });
});

// Speculate and restart (AIR spec_region): a pure function body or loop runs FAST — int arithmetic
// raw, each result range-checked by a labeled break — and on a bail its names are restored and
// the GENERIC (exact) body runs instead, and keeps running for later calls
describe('adder transpile — speculate and restart', () => {
  const emit = (src) => {
    const air = lowerAdder(adderParse(src), src);
    runPasses(air);
    return emitJS(air, ['_py', ...air.imports], [], { hinted: false });
  };
  const fact = 'def fact(n):\n    acc = 1\n    for i in range(1, n + 1):\n        acc *= i\n    return acc\n';
  it('a pure loop past 2**53 bails to the exact body; the next call is exact too', async () => {
    const src = fact + 'r = fact(10), fact(30), fact(5), fact(25)\n';
    for (const run of [airRun, twRun]) {
      const r = (await run(src)).r;
      assert.deepEqual([...r], [3628800, 265252859812191058636308480000000n, 120, 15511210043330985984000000n]);
    }
  });
  it('the fast body: raw checked ops, a labeled break — no try, no call on the check path', () => {
    const js = emit(fact);
    assert.match(js, /let _\d+ = \(acc \* i\);\n\s*if \(!\(_\d+ <= 9007199254740991 && _\d+ >= -9007199254740991\)\) break __bail\d+;/);
    assert.doesNotMatch(js, /\btry\b/);
    assert.match(js, /_py\.imul\)\(acc, i\)/);   // the generic body
  });
  it('a top-level loop, a range past 2**53, a BigInt argument, int literals past 2**31', async () => {
    const src = [
      't = 1', 'for i in range(1, 31):', '    t *= i',
      'def big(n):', '    t = 0', '    for i in range(n, n + 3):', '        t += i * 2', '    return t',
      'def sq(x: i32):', '    return x * x',
      'k = 3000000000', 'kk = k * k * k',
      'r = t, big(5), big(2 ** 64), big(2 ** 53 - 2), sq(3), sq(2 ** 40), kk',
    ].join('\n');
    for (const run of [airRun, twRun]) {
      const r = (await run(src)).r;
      assert.deepEqual([...r], [265252859812191058636308480000000n, 36, 110680464442257309702n, 54043195528445946n, 9, 1208925819614629174706176n, 27000000000000000000000000000n]);
    }
  });
  it('untyped operands are taken as numbers in a fast body — and anything else bails to the exact body', async () => {
    const src = [
      'def add(a, b):', '    return a + b',
      'class V:', '    def __init__(self, v): self.v = v', '    def __add__(self, o): return V(self.v + o.v)',
      'r = add(1, 2), add("x", "y"), add([1], [2]), add(1.5, 2), add(2 ** 60, 2 ** 60), add(True, 1), add(V(1), V(2)).v, add(3, 4)',
    ].join('\n');
    for (const run of [airRun, twRun]) {
      const r = (await run(src)).r;
      assert.deepEqual([r[0], r[1], [...r[2]], r[3], r[4], r[5], r[6], r[7]], [3, 'xy', [1, 2], 3.5, 2n ** 61n, 2, 3, 7]);
    }
    // an untyped `while i < n:` compiles raw: the comparison a typeof test and `<`, no helper call
    const js = emit('def w(n):\n    i = 0\n    while i < n:\n        i += 1\n    return i\n');
    assert.match(js, /if \(typeof n !== 'number'\) break __bail\d+;/);
    const fast = js.slice(js.indexOf('__bail'), js.indexOf('break __ok'));
    assert.match(fast, /\(i < n\)/);
    assert.doesNotMatch(fast, /_py\.(lt|truthy)/);
  });
  it('a region may call the module\'s other pure functions', async () => {
    const src = 'def sq(x):\n    return x * x\ndef sumsq(n):\n    t = 0\n    for i in range(n):\n        t += sq(i)\n    return t\n';
    assert.match(emit(src).split('function sumsq')[1], /__bail\d+/);   // sumsq is a region despite the call
    for (const run of [airRun, twRun]) {
      const r = (await run(src + 'r = sumsq(10), sumsq(20000), sumsq(10)\n')).r;
      assert.deepEqual([...r], [285, 2666466670000, 285]);
    }
    // a function the module rebinds is not pure: calling it keeps the caller out of a region
    const rebound = src.replace('def sumsq', 'sq = sq\ndef sumsq');
    assert.doesNotMatch(emit(rebound).split('function sumsq')[1], /__bail/);
  });
  it('machine_ints: raw unchecked int arithmetic, no regions', async () => {
    const src = 'from __adder__ import machine_ints\ndef tri(n):\n    t = 0\n    for i in range(n):\n        t += i * i\n    return t\n';
    const js = emit(src);
    assert.doesNotMatch(js, /__bail|__sp\d/);
    assert.match(js, /\(t \+ \(i \* i\)\)/);
    for (const run of [airRun, twRun]) assert.equal((await run(src + 'r = tri(1000)\n')).r, 332833500);
  });
  it('a rich comparison keeps its truth test: the result\'s __bool__ may raise (test_bool)', async () => {
    const src = [
      'class B:', '    def __bool__(self): raise TypeError("no truth")',
      'class S:', '    def __gt__(self, o): return B()',
      'def t(x):', '    try:', '        if x > 0:', '            return "true"', '        return "false"',
      '    except TypeError as e:', '        return str(e)',
      'r = t(S()), t(5), t(-1)',
    ].join('\n');
    for (const run of [airRun, twRun]) assert.deepEqual([...(await run(src)).r], ['no truth', 'true', 'false']);
  });
  it('code with effects is not speculated: its int arithmetic stays exact helpers', () => {
    const js = emit('def f(n):\n    t = 0\n    for i in range(n):\n        print(i)\n        t += i\n    return t\n');
    assert.doesNotMatch(js, /__bail/);
    assert.match(js, /_py\.iadd\)\(t, i\)/);
  });
});

// A compiled unit's JS depends only on its source and options — not on what compiled before it
// (each unit numbers its method-call cache slots from 0 in its own table): the property that lets
// a compiled module be cached and reused
describe('adder transpile — module-function calls and maybe-awaits', () => {
  const emit = (src) => {
    const air = lowerAdder(adderParse(src), src);
    runPasses(air);
    return emitJS(air, ['_py', ...air.imports], [], { hinted: false });
  };
  it('a call through a module: its function, a patched one, a callable instance, a class', async () => {
    const src = [
      'import math, fractions, collections',
      'class Twice:', '    def __call__(self, x): return 2 * x',
      'old = math.sqrt', 'a = math.sqrt(16)', 'math.sqrt = lambda x: -x', 'b = math.sqrt(4)', 'math.sqrt = old',
      'math.twice = Twice()',
      "r = a, b, math.sqrt(9), math.twice(21), str(fractions.Fraction(1, 3)), collections.Counter('aab')['a']",
    ].join('\n');
    for (const run of [airRun, twRun]) assert.deepEqual([...(await run(src)).r], [4, -4, 3, 42, '1/3', 2]);
  });
  it('a call is awaited only when it gives a thenable', () => {
    const js = emit('import math\ndef f(x):\n    return math.sqrt(x) + g(x)\n');
    assert.match(js, /\(\(_\d+_a = \(_py\.callMethod\)\(math, "sqrt", [^)]*\)\)\?\.then \? await _\d+_a : _\d+_a\)/);
    assert.match(js, /\(\(_\d+_a = \(_py\.fnOf\)\(g\)\(x\)\)\?\.then \? await _\d+_a : _\d+_a\)/);
    assert.doesNotMatch(js, /\(await \(_py\.(callMethod|fnOf)\)/);
  });
  it('a value with a "then" key, an argument spread before the call, a coroutine object', async () => {
    const src = [
      'import asyncio',
      'log = []',
      'class C:', '    def get(self): return {"then": 5}', "    def m(self):", "        log.append('m')", '        return 3',
      '    async def h(self): return 8',
      "def a():", "    log.append('a')", '    return [1, 2]',
      'def f(*xs): return xs',
      'async def g(): return 7',
      'async def main():', '    c = g()', '    d = C().h()', '    return type(c).__name__, await c, await d',
      'r = C().get()["then"], f(*a(), C().m()), log, asyncio.run(main())',
    ].join('\n');
    for (const run of [airRun, twRun]) {
      const r = (await run(src)).r;
      assert.equal(r[0], 5);
      assert.deepEqual([...r[1]], [1, 2, 3]);
      assert.deepEqual(r[2], ['a', 'm']);
      assert.deepEqual([...r[3]], ['coroutine', 7, 8]);
    }
  });
  it('a store runs its __setattr__ / __setitem__ to the end — an import of a loaded module inside one', async () => {
    // networkx's config: `self.x = v` runs a __setattr__ that does `from .backends import …`
    const src = [
      'import math',
      'class Cfg:',
      '    def __setattr__(self, k, v):',
      '        from math import sqrt',
      '        object.__setattr__(self, k, sqrt(v))',
      'class Box:',
      '    def __init__(self): self.d = {}',
      '    def __getitem__(self, k): return self.d[k]',
      '    def __setitem__(self, k, v):',
      '        import math',
      '        self.d[k] = math.floor(v)',
      'def mk():',
      '    c = Cfg()',
      '    c.x = 16',
      '    b = Box()',
      '    b["y"] = 2.5',
      '    return c.x, b["y"]',
      'r = mk()',
    ].join('\n');
    for (const run of [airRun, twRun]) assert.deepEqual([...(await run(src)).r], [4, 2]);
  });
  it('calling a cached_property value as a method caches it on the instance, not the class (networkx G.edges())', async () => {
    const src = [
      'from functools import cached_property',
      'class View:',
      '    def __init__(self, g): self.g = g',
      '    def __call__(self): return self',
      'class Graph:',
      '    @cached_property',
      '    def edges(self): return View(self)',
      'a = Graph()',
      'a.edges()',
      'b = Graph()',
      'r = [b.edges.g is b, b.edges().g is b, a.edges.g is a]',
    ].join('\n');
    for (const run of [airRun, twRun]) assert.deepEqual([...(await run(src)).r], [true, true, true]);
  });
  it('asyncio.gather runs each coroutine as a task: one runs until it really waits (CPython order)', async () => {
    const src = [
      'import asyncio',
      'log = []',
      'class Box:',
      '    def bump(self, name): log.append(name)',
      'async def worker(name, box):',
      '    for i in range(3): box.bump(name)',
      '    await asyncio.sleep(0)',
      '    for i in range(3): box.bump(name.upper())',
      '    return name',
      'async def main():',
      '    b = Box()',
      '    got = await asyncio.gather(worker("a", b), worker("b", b))',
      '    done = [await t for t in asyncio.as_completed([worker("c", b), worker("d", b)])]',
      '    return got, done',
      'got, done = asyncio.run(main())',
      'r = ["".join(log), list(got), sorted(done)]',
    ].join('\n');
    for (const run of [airRun, twRun]) assert.deepEqual([...(await run(src)).r].map((v) => (Array.isArray(v) ? [...v] : v)), ['aaabbbAAABBBcccdddCCCDDD', ['a', 'b'], ['c', 'd']]);
  });
  it("a dict subclass's own __setitem__ runs for d[k] = v, a tuple key and d[k] += v", async () => {
    const src = [
      'class Box(dict):',
      '    def __setitem__(self, k, v):',
      '        dict.__setitem__(self, k, v * 10)',
      'b = Box()',
      'b["a"] = 1',
      'b[1, 2] = 2',
      'b["a"] += 3',
      'r = [b["a"], b[1, 2]]',
    ].join('\n');
    for (const run of [airRun, twRun]) assert.deepEqual([...(await run(src)).r], [130, 20]);
  });
  it('an attribute store keeps a method synchronous (a constructor stays a plain function)', () => {
    const js = emit('class F:\n    def __init__(self, g):\n        self.g = g\n');
    assert.match(js, /"__init__": function \(self, g\)/);
    assert.doesNotMatch(js, /\bawait\b[^\n]*setattr/);
  });
});

// what vendoring CPython's mimetypes / ipaddress / tomllib / codeop / … surfaced: each a CPython
// behaviour adder missed, checked on both engines against the value CPython gives
describe('adder — CPython parity found by the stdlib sweep', () => {
  const both = async (lines, want) => {
    for (const run of [airRun, twRun]) assert.deepEqual([...(await run(lines.join('\n'))).r], want, run === airRun ? 'AIR' : 'tree-walker');
  };
  it('bytes are dict keys by value, hash like the latin-1 str, and b"" is false', () => both([
    'd = {b"k": 1}',
    'r = [d[b"k"], b"k" in d, "k".encode() in d, hash(b"ab") == hash(b"ab") == hash("ab"), len({b"a", bytes([97])}), bool(b""), bool(b"x"[1:]), b"a" == "a"]',
  ], [1, true, true, true, 1, false, false, false]));
  it('in / not in make a bool of a Python __contains__', () => both([
    'class S:',
    '    def __contains__(self, x): return x == 1',
    'class T:',
    '    def __contains__(self, x): return 5',
    's = S()',
    'r = [1 in s, 2 in s, 1 not in s, 2 not in s, 3 in T(), 3 not in T(), all(2 not in s for _ in [0])]',
  ], [true, false, false, true, true, false, true]));
  it("a class variable closer in the MRO beats a base's property or method — later assignments too", () => both([
    'class B:',
    '    @property',
    '    def k(self): return "prop"',
    '    def m(self): return "meth"',
    'class M: pass',
    'class C(M, B): k = "attr"',
    'class D(B):',
    '    k = "attr"',
    '    m = None',
    'class E(D): pass',
    'class F(E):',
    '    @property',
    '    def k(self): return "F"',
    'r = [C().k, D().k, D().m, E().k, E().m, F().k]',
    'D.k = "new"',
    'r.append(E().k)',
  ], ['attr', 'attr', null, 'attr', null, 'F', 'new']));
  it('super() through two classes from a property', () => both([
    'class A:',
    '    @property',
    '    def e(self): return self._x()',
    '    def _x(self): return "A"',
    'class B(A):',
    '    def _x(self): return "B" + super()._x()',
    'class C(B):',
    '    def _x(self): return super()._x()',
    'r = [C().e, C()._x(), B().e]',
  ], ['BA', 'BA', 'BA']));
  it('lru_cache keys by hash and == (not attributes), keeps keywords apart, refuses unhashables', () => both([
    'import functools',
    'n = [0]',
    '@functools.lru_cache(maxsize=None)',
    'def f(x, y=1):',
    '    n[0] += 1',
    '    return 0',
    'class P:',
    '    def __init__(s): s.v = 1',
    'a, b = P(), P()',
    'f(a); f(b); f(a); f(2); f(2, y=3); f(2, y=3); f(2**70); f(2**70)',
    'try:',
    '    f([1]); e = None',
    'except TypeError as x:',
    '    e = str(x)',
    'r = [n[0], e]',
  ], [5, "unhashable type: 'list'"]));
  it('re: flags by keyword, CPython\'s .flags, one Pattern per pattern, re.Pattern / re.Match', () => both([
    'import re',
    'p = re.compile(r"[Tt ]x  # c", flags=re.VERBOSE)',
    'r = [p.match(" x") is not None, p.flags, re.compile(b"a").flags, re.compile("a").flags, re.compile("a+") is re.compile("a+"),',
    '     type(p) is re.Pattern, type(p.match(" x")).__name__, re.Pattern.__module__, re.search(pattern="b", string="ab").group()]',
  ], [true, 96, 0, 32, true, true, 'Match', 're', 'b']));
  it("functions and methods: CPython's __qualname__, reprs, method objects", () => both([
    'import re',
    'def outer():',
    '    def inner(): pass',
    '    return inner',
    'class C:',
    '    def m(self): pass',
    '    @classmethod',
    '    def k(cls): pass',
    '    @staticmethod',
    '    def s(): pass',
    '    class N: pass',
    'c = C()',
    'a = lambda s: re.sub(r"0x[0-9A-F]+", "0x", s)',
    'r = [outer().__qualname__, C.m.__qualname__, C.N.__qualname__, a(repr(C.m)), a(repr(c.m)), a(repr(C.k)), a(repr(C.s)),',
    '     type(c.m).__name__, C.k.__func__.__qualname__, c.m.__self__ is c, repr(len)]',
  ], ['outer.<locals>.inner', 'C.m', 'C.N', '<function C.m at 0x>', '<bound method C.m of <__main__.C object at 0x>>',
    "<bound method C.k of <class '__main__.C'>>", '<function C.s at 0x>', 'method', 'C.k', true, '<built-in function len>']));
  it('os.path is posixpath to the edge cases', () => both([
    'import posixpath as P',
    'r = [P.basename(""), P.dirname(""), P.basename("a/"), P.normpath(""), P.normpath("//a//b"), P.normpath("///a"), P.join("a", "/b", "c"),',
    '     P.splitext(".bashrc")[1], P.splitext("x.tar.gz")[1], P.relpath("/a/b/c", "/a/x"), P.commonpath(["/a/b/c", "/a/bx"])]',
  ], ['', '', '', '.', '//a/b', '/a', '/b/c', '', '.gz', '../b/c', '/a']));
  it('a map over a Python function: int.from_bytes, *args, list displays', () => both([
    'def g(x): return x + 1',
    'def h(*a): return a',
    'r = [int.from_bytes(map(g, [0, 1]), "big"), repr(h(*map(g, [1, 2]))), repr([*map(g, [5])])]',
  ], [258, '(2, 3)', '[6]']));
  it('iter(callable, sentinel) over a Python method', () => both([
    'class R:',
    '    def __init__(s): s.n = 0',
    '    def rd(s):',
    '        s.n += 1',
    '        return s.n if s.n < 4 else 0',
    'out = []',
    'for x in iter(R().rd, 0): out.append(x)',
    'r = [repr(out), sum(iter(R().rd, 0))]',
  ], ['[1, 2, 3]', 6]));
  it('pickle keeps an int past 2**53 exact; encode_long / decode_long', () => both([
    'import pickle',
    'x = 2**70 + 1',
    'r = [all(pickle.loads(pickle.dumps(v, protocol=p)) == v for p in (0, 2, 5) for v in (x, -x)), repr(pickle.encode_long(-256)), pickle.decode_long(b"\\xff\\x00"), pickle.MARK]',
  ], [true, "b'\\x00\\xff'", 255, Uint8Array.of(40)]));
  it('compile() raises a SyntaxError now; codeop tells incomplete input from a bad one', () => both([
    'import codeop',
    'try:',
    '    compile("x = 1)", "<s>", "exec"); e = None',
    'except SyntaxError: e = "SyntaxError"',
    'def cc(s):',
    '    try: return "none" if codeop.compile_command(s) is None else "code"',
    '    except SyntaxError: return "error"',
    'r = [e] + [cc(s) for s in ["x = 1", "if x:", "if x:\\n  pass", "if x:\\n  pass\\n", "x = (1,", "x = 1)", "def f(:", "\'\'\'abc", "a = \\\\", "@dec", "for i in r: pass"]]',
  ], ['SyntaxError', 'code', 'none', 'none', 'code', 'none', 'error', 'error', 'none', 'none', 'none', 'none']));
  it('an unterminated string is a SyntaxError, not a string ending at the line', async () => {
    for (const src of ["x = 'abc\ny = 1", 'x = """abc', "x = f'a{1}"]) {
      for (const run of [airRun, twRun]) await assert.rejects(run(src), /unterminated/);
    }
  });
  it('identifiers in any script; a backslash-newline inside a literal continues it', () => both([
    'größe = 3',
    'π = 2',
    's = """\\',
    'abc"""',
    'r = [größe * π, s]',
  ], [6, 'abc']));
  it('bytes in bytes is a subsequence test; an int a byte value', () => both([
    'r = [b" " in b" \\t", b"ab" in b"xaby", b"" in b"x", b"z" in b"xy", 97 in b"abc", b"b" in bytearray(b"abc")]',
  ], [true, true, true, false, true, true]));
  it('print writes to a replaced sys.stdout; redirect_stdout makes sys.stdout the target', () => both([
    'import sys, io, contextlib',
    'buf, old = io.StringIO(), sys.stdout',
    'sys.stdout = buf',
    'print("hi")',
    'sys.stdout = old',
    'b2 = io.StringIO()',
    'with contextlib.redirect_stdout(b2):',
    '    print("rd"); same = sys.stdout is b2',
    'r = [buf.getvalue(), b2.getvalue(), same]',
  ], ['hi\n', 'rd\n', true]));
  it('bytes.fromhex, and hex / bin through __index__ only', () => both([
    'class I:',
    '    def __int__(self): return 5',
    'class J:',
    '    def __index__(self): return 6',
    'try:',
    '    hex(I()); e = None',
    'except TypeError: e = "TypeError"',
    'r = [repr(bytes.fromhex("0a ff")), repr(bytearray.fromhex("01")), hex(J()), bin(J()), e]',
  ], ["b'\\n\\xff'", "bytearray(b'\\x01')", '0x6', '0b110', 'TypeError']));
  it("the format-spec mini-language for numbers, as CPython's", () => both([
    'r = [format(1234567, "_b"), format(255, "#_x"), format(255, "#010x"), format(1234, "010,"), format(-3, " d"), format(5, "+#o"),',
    '     format(-0.0004, "z.2f"), format(1234.5678, "012,.2f"), format(0.5, "#.0f"), f"{65:c}", f"{1234.5:_.1f}"]',
  ], ['1_0010_1101_0110_1000_0111', '0xff', '0x000000ff', '00,001,234', '-3', '+0o5', '0.00', '0,001,234.57', '0.', 'A', '1_234.5']));
  it('*x in a list display or a call goes through iteration: a generator method, a dict', () => both([
    'class T:',
    '    def gen(self):',
    '        yield 1',
    '        yield 2',
    'def f(*a): return list(a)',
    'r = [repr([*T().gen()]), repr(f(*T().gen())), repr([*{"a": 1}])]',
  ], ['[1, 2]', '[1, 2]', "['a']"]));
  it("the parser refuses what CPython's does", async () => {
    for (const src of ['a b', 'x = [1, 2', 'del 1', 'del (a, 2)', 'return 1', 'class C:\n    return 1']) {
      for (const run of [airRun, twRun]) await assert.rejects(run(src), /syntax|never closed|cannot delete|outside function/i, src);
    }
  });
  it('globals passed around and called later (timeit), and types.ModuleType is the type of a module', () => both([
    'import sys, types',
    'x = 5',
    '_g = globals',
    'def f(): return _g()["x"]',
    'm = type(sys)("mm")',
    'r = [f(), _g is globals, type(sys) is types.ModuleType, m.__name__, types.ModuleType.__name__]',
  ], [5, true, true, 'mm', 'module']));
  it("a generator expression's first iterable is evaluated where it stands (glob's names = (… in names))", () => both([
    'def f(names):',
    '    names = (x for x in names if x != 2)',
    '    return list(names)',
    'bad = None',
    'try:',
    '    g = (x for x in 5)',
    'except TypeError:',
    '    bad = "TypeError"',
    'r = [f([1, 2, 3]), bad]',
  ], [[1, 3], 'TypeError']));
  it("a for loop's variable — and what its body binds — in a class body are class attributes", () => both([
    'class C:',
    '    n = 0',
    '    for x in ["a", "b"]:',
    '        n += 1',
    '        last = x',
    '    seen = (x, last)',
    'r = [C.n, C.x, C.last, list(C.seen)]',
  ], [2, 'b', 'b', ['b', 'b']]));
  it("OSError(errno, strerror[, filename]) as CPython's: the attributes, the message, the subclass by errno", () => both([
    'e = OSError(2, "gone", "f.txt")',
    'f = OSError("plain")',
    'r = [type(e).__name__, e.errno, e.strerror, e.filename, str(e), list(e.args), f.errno, str(f), type(OSError(17, "x")).__name__]',
  ], ['FileNotFoundError', 2, 'gone', 'f.txt', "[Errno 2] gone: 'f.txt'", [2, 'gone'], null, 'plain', 'FileExistsError']));
  it('tree-walked generators feed itertools.chain (recursive glob)', () => both([
    'import itertools',
    'def g():',
    '    yield 1',
    '    yield 2',
    'r = list(itertools.chain((0,), g()))',
  ], [0, 1, 2]));
  // ── found by CPython's pathlib / shutil ──
  it("super() skips a base's copy of an inherited member: Path's super().__init__ is PurePath's", () => both([
    'class PB:',
    '    def __init__(self): self.who = "PB"',
    'class P(PB):',
    '    def __init__(self): self.who = "P"',
    'class B(PB): pass',
    'class Pa(B, P):',
    '    def __init__(self): super().__init__()',
    'r = [Pa().who, [c.__name__ for c in Pa.__mro__]]',
  ], ['P', ['Pa', 'B', 'P', 'PB', 'object']]));
  it('a builtin function as a class variable overrides a base method, unbound (glob._StringGlobber)', () => both([
    'import operator',
    'class A:',
    '    def f(self, x): return "A.f"',
    '    def g(self, x, y): return "A.g"',
    'class B(A):',
    '    f = len',
    '    g = operator.add',
    'class C(B): pass',
    'r = [B().f("xy"), B().g("a", "b"), C().f("xyz")]',
  ], [2, 'ab', 3]));
  it('iter() of an instance with neither __iter__ nor __getitem__ is a TypeError (unittest tells a case from a suite so)', () => both([
    'class A: pass',
    'class S:',
    '    def __getitem__(self, i):',
    '        if i < 2: return i',
    '        raise IndexError',
    'out = []',
    'for o in (A(), object()):',
    '    try:',
    '        iter(o)',
    '        out.append("iterable")',
    '    except TypeError as e:',
    '        out.append(str(e))',
    'r = [out, list(S())]',
  ], [["'A' object is not iterable", "'object' object is not iterable"], [0, 1]]));
  it('a bare raise in a function called from an except block re-raises the exception being handled', () => both([
    'def onexc(*a):',
    '    raise',
    'got = None',
    'try:',
    '    try:',
    '        {}["k"]',
    '    except KeyError:',
    '        onexc()',
    'except KeyError as e:',
    '    got = type(e).__name__',
    'r = [got]',
  ], ['KeyError']));
  it('modules hash by identity; a BytesIO subclass gets its own __init__ arguments', () => both([
    'import io, os, functools',
    '@functools.cache',
    'def sens(mod): return mod.normcase("Aa") == "Aa"',
    'class D(io.BytesIO):',
    '    def __init__(self, files, key):',
    '        super().__init__()',
    '        self.files, self.key = files, key',
    'files = {}',
    'd = D(files, "k")',
    'd.write(b"hi")',
    'r = [sens(os.path), hash(os) == hash(os), d.getvalue(), d.key]',
  ], [true, true, new TextEncoder().encode('hi'), 'k']));
  it("bytes methods take bytes-likes, not str; int() parses bytes (tarfile's int(b'0000644', 8))", () => both([
    'out = []',
    'for f in (lambda: b"abc".startswith("a"), lambda: b"a.b".split("."), lambda: b"abc".find("b"), lambda: "abc".startswith(b"a")):',
    '    try:',
    '        out.append(f())',
    '    except TypeError as e:',
    '        out.append(str(e))',
    'r = [out, b"abc".startswith(memoryview(b"ab")), int(b"0000644", 8), int(bytearray(b" 12 "))]',
  ], [['startswith first arg must be bytes or a tuple of bytes, not str', "a bytes-like object is required, not 'str'",
    "argument should be integer or bytes-like object, not 'str'", 'startswith first arg must be str or a tuple of str, not bytes'], true, 420, 12]));
});

describe('adder transpile — deterministic output', () => {
  const emit = (src, opts) => {
    const air = lowerAdder(adderParse(src), src, opts);
    runPasses(air);
    return emitJS(air, ['_py', ...air.imports], [], { hinted: false });
  };
  it('compiling the same source twice gives the same JS, with other compiles between', () => {
    const src = 'class C:\n    def f(self, x):\n        return x.g(1) + self.h()\n    def h(self):\n        return [].copy()\n';
    const a = emit(src, { module: { package: '' } });
    emit('y = [].append(1)\nz = "a".upper()\n');
    const b = emit(src, { module: { package: '' } });
    assert.equal(a, b);
    assert.match(a, /\$pic = \(_py\.pics\)\(\d+\)/);
  });
  it('a method whose only wait is its for loop keeps its sync twin (Set._hash from a hash)', async () => {
    // _collections_abc's Set._hash: its one async-capable part is `for x in self` (a hybrid loop,
    // whose awaits emit-js writes) — without a twin, __hash__'s sync call got a Promise
    const r = await airRun([
      'from collections.abc import Set',
      'class S(Set):',
      '    def __init__(self): self.c = [1, 2, 3]',
      '    def __contains__(self, x): return x in self.c',
      '    def __len__(self): return len(self.c)',
      '    def __iter__(self): return iter(self.c)',
      '    def __hash__(self): return self._hash()',
      'h1, h2 = hash(S()), hash(S())',
    ].join('\n'));
    assert.equal(typeof r.h1, 'number');
    assert.equal(r.h1, r.h2);
  });
  it('two units do not share call-site slots', async () => {
    const r = await runTranspile([
      'class A:',
      '    def m(self): return "A"',
      'class B:',
      '    def m(self): return "B"',
      'def f(o): return o.m()',
      'print(f(A()), f(B()), f(A()))',
    ].join('\n'));
    assert.equal(r.output, 'A B A');
  });

  it('a call site\'s cache never holds the JS base\'s method for a builtin subclass (Map get, Array pop)', async () => {
    // the second call through a site took the cached Map.prototype.get (no default) /
    // Array.prototype.pop (no index); a subclass's own get is still its own
    const r = await runTranspile([
      'class C(dict): pass',
      'c = C(a=1)',
      'class L(list): pass',
      'l = L([1, 2, 3, 4])',
      'class D(dict):',
      '    def get(self, k, d=None): return "own"',
      'print([c.get(k, 0) for k in ["a", "b"]], [l.pop(0) for _ in range(2)], list(l), [D().get(i, 0) for i in range(2)])',
    ].join('\n'));
    assert.equal(r.output, "[1, 0] [1, 2] [3, 4] ['own', 'own']");
  });
});
