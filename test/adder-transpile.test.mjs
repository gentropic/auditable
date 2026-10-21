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
    return emitJS(air, ['_py', ...air.imports], [], { hinted: true });
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
  it('trust_annotations types int as a non-wrapping number: raw ops, exact past 2**31', async () => {
    const src = 'from __adder__ import trust_annotations\n' + fib;
    const js = emit(src);
    assert.match(js, /fib\(\(n - 1\)\) \+ fib\(\(n - 2\)\)/);
    assert.doesNotMatch(js, /\| 0/);
    const dbl = 'from __adder__ import trust_annotations\ndef dbl(n: int) -> int:\n    return n + n\nr = dbl(2**40), dbl(-3)\n';
    assert.doesNotMatch(emit(dbl), /_py\.add/);
    for (const run of [airRun, twRun]) assert.deepEqual([...(await run(dbl)).r], [2 ** 41, -6]);
  });
  it('AIR hint names are types without the flag (i32 wraps, as declared)', () => {
    assert.match(emit(fib.replace(/int/g, 'i32')), /\(\(\(fib\(\(\(\(n - 1\)\) \| 0\)\)/);
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

// A compiled unit's JS depends only on its source and options — not on what compiled before it
// (each unit numbers its method-call cache slots from 0 in its own table): the property that lets
// a compiled module be cached and reused
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
