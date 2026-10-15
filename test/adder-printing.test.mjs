// adder's str / repr for raw typed arrays and non-finite floats
// (spec_inbox/lang/adder-printing-spec.md): learn hands back Float64Array / Int32Array, 2-D
// ones as a flat array with a `shape`; they print as Python lists, and inf / -inf / nan are
// spelled Python's way in str, repr, print, f-strings and format().
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { run, registerModule, unregisterModule } = await import('../ext/adder/src/index.js');
const { pyRepr, pyStr, pyFormatValue } = await import('../ext/adder/src/builtins.js');

const shaped = (arr, shape) => { arr.shape = shape; return arr; };
const SRC = {
  f64: () => Float64Array.from([1, 2.5]),
  coef: () => Float64Array.from([1.9999999999999991]),
  grid: () => shaped(Float64Array.from([1, 2, 3, 4, 5, 6]), [2, 3]),
  col: () => shaped(Float64Array.from([-1.5, 0, 1.5]), [3, 1]),
  ints: () => Int32Array.from([0, 0, 1, 1]),
  f32: () => Float32Array.from([0.5, 2]),
  badshape: () => shaped(Float64Array.from([1, 2, 3]), [2, 2]),
  nonfinite: () => Float64Array.from([Infinity, -Infinity, NaN, -0]),
};

async function printed(code) {
  const out = [];
  registerModule('src', SRC);
  try { await run(code, { stdout: (s) => out.push(s) }); } finally { unregisterModule('src'); }
  return out.join('').replace(/\n$/, '');
}

test('typed arrays print as Python lists, floats keep .0, ints do not', async () => {
  assert.equal(await printed('import src\nprint(src.f64())'), '[1.0, 2.5]');
  assert.equal(await printed('import src\nprint(src.coef())'), '[1.9999999999999991]');
  assert.equal(await printed('import src\nprint(src.ints())'), '[0, 0, 1, 1]');
  assert.equal(await printed('import src\nprint(src.f32())'), '[0.5, 2.0]');
  assert.equal(await printed('import src\nprint(repr(src.f64()))'), '[1.0, 2.5]');
  assert.equal(await printed('import src\nprint(str(src.ints()))'), '[0, 0, 1, 1]');
});

test('a shape nests row-major; a shape that does not fit the length is ignored', async () => {
  assert.equal(await printed('import src\nprint(src.grid())'), '[[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]');
  assert.equal(await printed('import src\nprint(src.col())'), '[[-1.5], [0.0], [1.5]]');
  assert.equal(await printed('import src\nprint(src.badshape())'), '[1.0, 2.0, 3.0]');
});

test('inf, -inf and nan in print, repr, str, f-strings and format()', async () => {
  assert.equal(await printed('print(float("inf"), -float("inf"), float("nan"))'), 'inf -inf nan');
  assert.equal(await printed('print(1e400)'), 'inf');
  assert.equal(await printed('print(repr(float("inf")) == "inf")'), 'True');
  assert.equal(await printed('print(str(float("nan")) == "nan")'), 'True');
  assert.equal(await printed('x = float("nan")\nprint(f"{x}")'), 'nan');
  assert.equal(await printed('x = float("inf")\nprint(f"{x:.2f}|{-x:8.3f}|{x:+}")'), 'inf|    -inf|+inf');
  assert.equal(await printed('print(format(float("inf"), "E"), format(float("nan"), "%"))'), 'INF nan%');
  assert.equal(await printed('print([float("inf"), 1.5])'), '[inf, 1.5]');
  assert.equal(await printed('import src\nprint(src.nonfinite())'), '[inf, -inf, nan, -0.0]');
});

test('bytes keep their old form; finite numbers are unchanged', () => {
  assert.equal(pyRepr(3), '3');
  assert.equal(pyRepr(2.5), '2.5');
  assert.equal(pyStr(-0.25), '-0.25');
  assert.equal(pyFormatValue(3.14159, '.2f'), '3.14');
  assert.notEqual(pyRepr(Uint8Array.from([1, 2])), '[1, 2]');
});

test('dicts print as Python dicts, both representations; dict() takes a mapping, pairs and keywords', async () => {
  assert.equal(await printed('print({"a": 1, "b": [1, 2]})'), "{'a': 1, 'b': [1, 2]}");
  assert.equal(await printed('print(dict(a=1), dict([("x", 1), (2, "y")]), dict({"k": 1}, z=2), dict())'), "{'a': 1} {'x': 1, 2: 'y'} {'k': 1, 'z': 2} {}");
  assert.equal(await printed('d = {"a": 1}\nprint(isinstance(d, dict), repr(d), f"{d}")'), "True {'a': 1} {'a': 1}");
  assert.equal(await printed('class P:\n    def __repr__(self):\n        return "P!"\nprint({"p": P()})'), "{'p': P!}");
  assert.equal(pyRepr({ a: 1 }), "{'a': 1}");
});
