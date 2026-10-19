// @gcu/air — adder (Python) → AIR lowerer
// Translates adder's Python AST into AIR ops. Python semantics preserved via
// calls to _py runtime helpers. Throws AirLowerError for unsupported nodes,
// triggering fallback to the tree-walker.

import {
  I32, F64, BOOL, STRING, VOID, DYNAMIC,
  I8, U8, I16, U16, U32, I64, U64, F32,
  typedArray, isDynamic, isNumeric, arithmeticResult, func,
} from '../../air/src/types.js';
import {
  BaseLowerCtx, captureOps, emitPhiSelect, AirLowerError,
  lowerIfRegion, lowerLoopRegion,
} from '../../air/src/lower/base.js';
import { registerSpecializations } from '../../air/src/passes.js';
import { classAnnotations, plainObjectKey } from './builtins.js';
import { collectWalrusTargets, matchPatternNames, compileMatchPattern, classNeedsCell } from './parse.js';

// Re-export AirLowerError from @gcu/air. Lifted to ext/air/src/lower/base.js
// so all frontends share one definition; the marker `_airFallback: true`
// is the load-bearing contract that AIR's wrapper checks.
export { AirLowerError, PY_SPECIALIZATIONS };

// ── _py runtime helper specializations ─────────────────────────────
//
// When the type-prop pass can prove operand types, these rewrites
// replace `_py.method(args)` calls with raw AIR ops — emitted as
// native JS operators, skipping the helper round-trip. The big win
// for typed numeric loops in adder cells.
//
// Used to live in passes.js (hardcoded for both _py and _soft), now
// lives alongside the lowerer that emits the helper calls in the first
// place. Same pattern soft uses for _soft.

const _bothNumeric = (lt, rt) => isNumeric(lt) && isNumeric(rt);

const PY_SPECIALIZATIONS = {
  add: {
    op: 'add',
    // Numbers: same-type addition. Strings: concat. Mixed: skip.
    check: (lt, rt) => {
      if (isNumeric(lt) && isNumeric(rt)) return true;
      if (lt.kind === 'string' && rt.kind === 'string') return true;
      return false;
    },
    resultType: (lt, rt) => {
      if (isNumeric(lt) && isNumeric(rt)) return arithmeticResult(lt, rt);
      return STRING;
    },
  },
  // `x += y` on numbers or strings is plain `+`: neither is mutable, so there is no __iadd__
  // and no list-extend to dispatch to.
  iadd: {
    op: 'add',
    check: (lt, rt) => (isNumeric(lt) && isNumeric(rt)) || (lt.kind === 'string' && rt.kind === 'string'),
    resultType: (lt, rt) => (isNumeric(lt) ? arithmeticResult(lt, rt) : STRING),
  },
  sub: { op: 'sub', check: _bothNumeric, resultType: arithmeticResult },
  mul: { op: 'mul', check: _bothNumeric, resultType: arithmeticResult },
  isub: { op: 'sub', check: _bothNumeric, resultType: arithmeticResult },
  imul: { op: 'mul', check: _bothNumeric, resultType: arithmeticResult },
  // Stay in helpers, because JS differs from Python on values the types can't rule out:
  //   div/mod/floordiv — Python raises ZeroDivisionError, JS returns Infinity/NaN;
  //   pow — `0 ** -1` raises in Python, is Infinity in JS;
  //   and_/or_/xor/rshift — JS bitwise ops truncate to 32 bits; Python ints don't
  //     (`(h * 31 + c) & 0xFFFFFFFF` must stay unsigned). An integer type says
  //     "integer-valued", not "fits in 32 bits": adder ints are unbounded doubles.
  eq:  { op: 'eq',  check: _bothNumeric, resultType: () => BOOL },
  neq: { op: 'neq', check: _bothNumeric, resultType: () => BOOL },
  lt:  { op: 'lt',  check: _bothNumeric, resultType: () => BOOL },
  lte: { op: 'lte', check: _bothNumeric, resultType: () => BOOL },
  gt:  { op: 'gt',  check: _bothNumeric, resultType: () => BOOL },
  gte: { op: 'gte', check: _bothNumeric, resultType: () => BOOL },
  // `_py.isThen(v)` (the `+=` await guard) is false for a value that is provably a number,
  // string or bool; the guarded `await` branch is then pruned.
  isThen: {
    op: null, arity: 1,
    check: (t) => isNumeric(t) || t.kind === 'string' || t.kind === 'bool',
    resultType: () => BOOL,
    constValue: false,
  },
  neg: {
    op: 'neg',
    arity: 1,
    check: (t) => isNumeric(t),
    resultType: (t) => t,
  },
  truthy: {
    // _py.truthy(true) → just the value (already bool)
    // _py.truthy(x) where x is numeric → x !== 0 (handled via coerce)
    op: null, arity: 1,
    check: (t) => t.kind === 'bool',
    resultType: () => BOOL,
    passthrough: true,
  },
};

// Register at module-init. Two paths:
//   1. Dev/Node (tests): the import above resolves; registerSpecializations
//      is the function from passes.js. Call it directly.
//   2. Browser bundle: imports get stripped at build time, so
//      `registerSpecializations` is undeclared. Fall back to the window
//      hook AIR exposes at runtime.
const _doRegisterPy = (typeof registerSpecializations === 'function')
  ? registerSpecializations
  : (typeof window !== 'undefined' ? window._airRegisterSpecializations : null);
if (_doRegisterPy) _doRegisterPy('_py', PY_SPECIALIZATIONS);

// ── adder annotation resolver ──
//
// Maps adder type annotations (whatever's after `:` or `->`) to AIR types.
// Annotations are opt-in performance hints; unknown shapes → DYNAMIC, which
// means passes fall back to dataflow inference (current default).
//
// Supported names:
//   - Python: int → i32, float → f64, bool → bool, str → string, None → void
//   - Direct AIR: i8, u8, i16, u16, i32, u32, i64, u64, f32, f64, bool, string,
//                 void, dynamic
//   - Typed arrays: Int32Array, Float64Array, ..., i32array, f64array, ...
//
// Returns DYNAMIC for anything we don't recognise — including subscripts
// (`list[int]`, `dict[str, int]`), unions, generic tuples — so the rest of
// the pipeline keeps working unchanged.
const _ADDER_NAME_TO_TYPE = {
  // Python builtins
  'int': I32, 'float': F64, 'bool': BOOL, 'str': STRING,
  'None': VOID, 'NoneType': VOID,
  // Direct AIR primitive names — same set the JS lowerer recognises
  'i8': I8, 'u8': U8, 'i16': I16, 'u16': U16,
  'i32': I32, 'u32': U32, 'i64': I64, 'u64': U64,
  'f32': F32, 'f64': F64, 'string': STRING, 'void': VOID,
  'dynamic': DYNAMIC,
  // Typed-array constructors (matches TS_TYPE_MAP in types.js)
  'Int8Array': typedArray('i8'), 'Uint8Array': typedArray('u8'),
  'Int16Array': typedArray('i16'), 'Uint16Array': typedArray('u16'),
  'Int32Array': typedArray('i32'), 'Uint32Array': typedArray('u32'),
  'Float32Array': typedArray('f32'), 'Float64Array': typedArray('f64'),
  'BigInt64Array': typedArray('i64'), 'BigUint64Array': typedArray('u64'),
  // GCU typed-array aliases
  'i8array': typedArray('i8'), 'u8array': typedArray('u8'),
  'i16array': typedArray('i16'), 'u16array': typedArray('u16'),
  'i32array': typedArray('i32'), 'u32array': typedArray('u32'),
  'f32array': typedArray('f32'), 'f64array': typedArray('f64'),
  'i64array': typedArray('i64'), 'u64array': typedArray('u64'),
};

function resolveAdderAnnotation(node) {
  if (!node) return DYNAMIC;
  // Bare name: `int`, `float`, `i32`, `Int32Array`, `None`, …
  if (node.type === 'Name' && typeof node.id === 'string') {
    return _ADDER_NAME_TO_TYPE[node.id] ?? DYNAMIC;
  }
  // `None` written as a literal constant in some annotation shapes.
  if (node.type === 'Constant' && node.value === null) return VOID;
  // Subscripts like `list[int]` aren't generic-aware in v1; keep dynamic so
  // the type system doesn't lie about element types.
  return DYNAMIC;
}

// ── SSA counter (shared across lowerer invocations via module state) ──

// ── Lowering context ──
//
// Adder-specific extras over BaseLowerCtx:
//   declared       — names already emitted with `let` at top level (so
//     repeat assignments emit as bare `name = …`, not redeclarations).
//   syncFunctions  — populated by analyseSyncFunctions before any body
//     is lowered. Calls to a name in this set skip the `await` wrapping
//     that adder otherwise emits around every user call (Python's
//     `f()` could yield a coroutine, JS's can't tell at call time).
// loc() reads adder-AST nodes' `node.line` / `node.col` (different
// shape from ESTree's `node.loc.start`).

class AdderLowerCtx extends BaseLowerCtx {
  constructor() {
    super();
    this.declared = new Set();
    this.syncFunctions = new Set();
    // Counter for `_py.callMethod` polymorphic-inline-cache sites, per compiled unit: the k-th
    // `obj.method(...)` site passes slot k of the table the unit makes when it runs
    // (`const $pic = _py.pics(n)`, see lowerAdder) — so the emitted code doesn't depend on what
    // compiled before it, and two units never share a slot
    this._callSiteId = 0;
    this._modeDependent = 0;
  }
  nextCallSiteId() { return this._callSiteId++; }
  // the ops that put a Python name into the JS as a binding (see jsSafeName)
  emit(op, args, type, loc, extra) {
    // in a class body, a name the body binds is `__cb_<name>`: the methods compiled inside it
    // (JS closures) must not see the class's names — Python's don't — so their `x` reaches the
    // module's x. The members object maps each name back (lowerClassDef).
    // a comprehension's variable is one binding for the whole comprehension (_lowerCompLoops)
    if ((op === 'store' || op === 'load') && typeof args[0] === 'string' && this._compRename && this._compRename.has(args[0])) {
      args = [this._compRename.get(args[0]), ...args.slice(1)];
    } else if ((op === 'store' || op === 'load') && typeof args[0] === 'string' && this._classBodyOf && this._classNames && this._classNames.has(args[0])) {
      args = [`__cb_${args[0]}`, ...args.slice(1)];
    }
    // what lowering in sync mode would do differently (lowerFuncDef: a body with none of it
    // needs no second, sync-mode copy — it would be the same code)
    // (a hybrid or `async for` loop awaits too: emit-js writes its awaits)
    if (op === 'await' || op === 'func_region' || op === 'class_region' ||
        (op === 'for_of_region' && extra && (extra.hybrid || extra.is_await))) this._modeDependent++;
    // sync mode (see AWAITED_DUNDERS): no await — the value is taken as it is
    // (in a twin: _py.needSync, which gives the twin up at a real Promise — see builtins syncOf)
    if (op === 'await' && this._syncMode) return emitPyCall(this, this._twinMode ? 'needSync' : 'noAwait', [{ id: args[0] }], loc, type);
    const pyName = (op === 'store' && typeof args[0] === 'string') ? args[0] : null;
    if ((op === 'store' || op === 'load') && typeof args[0] === 'string' && _JS_RESERVED.has(args[0])) args = [jsSafeName(args[0]), ...args.slice(1)];
    // module mode: a module-level binding (at top level, or from a function declaring it
    // `global`) is mirrored onto the live module object right after the store, so a circular
    // import — and anyone holding the module — sees names as they are bound
    if (pyName !== null && this.moduleMirror && ((this.topLevel && this.defines.has(pyName)) || (this._fnGlobals && this._fnGlobals.has(pyName)))) {
      const r = super.emit(op, args, type, loc, extra);
      // (not the `undefined` a name is pre-declared with: unbound is not an attribute; None is null)
      super.emit('opaque', [`if (${jsSafeName(pyName)} !== undefined) __adder_module__[${JSON.stringify(pyName)}] = ${jsSafeName(pyName)};`], VOID, null);
      return r;
    }
    else if (op === 'func_region' && extra) {
      if (typeof args[0] === 'string') args = [jsSafeName(args[0]), ...args.slice(1)];
      extra = { ...extra, name: extra.name ? jsSafeName(extra.name) : extra.name,
        params: extra.params ? extra.params.map((p) => (p && typeof p.name === 'string' && _JS_RESERVED.has(p.name) ? { ...p, name: jsSafeName(p.name) } : p)) : extra.params };
    } else if (op === 'for_of_region' && extra && _JS_RESERVED.has(extra.target_name)) extra = { ...extra, target_name: jsSafeName(extra.target_name) };
    else if (op === 'opaque' && extra && _JS_RESERVED.has(extra._markDeclared)) extra = { ...extra, _markDeclared: jsSafeName(extra._markDeclared) };
    return super.emit(op, args, type, loc, extra);
  }
  loc(node) {
    return node?.line != null ? { line: node.line, col: node.col || 0 } : null;
  }
  // Python's `bool()` semantics: empty list/dict/string/zero/None are
  // falsy. The _py.truthy runtime helper encodes these correctly; AIR's
  // bare condition check would just JS-coerce, which gets it wrong for
  // empty-list-is-truthy-in-JS-but-falsy-in-Python cases.
  truthy(valueOp, loc) {
    return this.emitNamespacedCall('_py', 'truthy', [valueOp], loc, BOOL);
  }
}

// ── Python names that JS reserves ──
// `default`, `case`, `enum`, `eval`, ... are ordinary Python names but not legal JS bindings
// (strict mode). In the emitted JS they become `name$` — `$` can't occur in a Python
// identifier, so nothing collides. Everything Python sees keeps the Python name: keyword
// arguments, class attributes, the names a cell exports and the free names it reads.
const _JS_RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static',
  'implements', 'interface', 'package', 'private', 'protected', 'public', 'await', 'arguments', 'eval',
  // not keywords, but emitted code relies on them meaning what JS means (jinja2's templates have a local `undefined`)
  'undefined']);
export function jsSafeName(n) { return typeof n === 'string' && _JS_RESERVED.has(n) ? `${n}$` : n; }
export function pyNameOf(n) { return typeof n === 'string' && n.endsWith('$') && _JS_RESERVED.has(n.slice(0, -1)) ? n.slice(0, -1) : n; }

// ── Module-level define collection ──
// Python: any assignment at module level creates a binding in module scope.
// Descends into if/for/while/try/with blocks (no scope) but not def/class.

function collectDefines_ad(stmts, defines) {
  for (const node of stmts || []) {
    collectWalrusTargets(node, defines);
    switch (node.type) {
      case 'Assign':
        for (const t of node.targets) collectTargetNames(t, defines);
        break;
      case 'AugAssign':
      case 'AnnAssign':
        collectTargetNames(node.target, defines);
        break;
      case 'FunctionDef':
      case 'AsyncFunctionDef':
      case 'ClassDef':
        defines.add(node.name);
        break;
      case 'Import':
        for (const alias of node.names) defines.add(alias.alias || alias.module.split('.')[0]);   // import a.b binds a
        break;
      case 'ImportFrom':
        for (const alias of node.names) if (alias.name !== '*') defines.add(alias.alias || alias.name);
        break;
      case 'For': case 'AsyncFor':
        collectTargetNames(node.target, defines);
        collectDefines_ad(node.body, defines);
        if (node.orelse) collectDefines_ad(node.orelse, defines);
        break;
      case 'While':
        collectDefines_ad(node.body, defines);
        if (node.orelse) collectDefines_ad(node.orelse, defines);
        break;
      case 'If':
        collectDefines_ad(node.body, defines);
        if (node.orelse) collectDefines_ad(node.orelse, defines);
        break;
      case 'With': case 'AsyncWith':
        for (const item of node.items) {
          if (item.optionalVar) collectTargetNames(item.optionalVar, defines);
        }
        collectDefines_ad(node.body, defines);
        break;
      case 'Match':
        for (const c of node.cases) {
          for (const n of matchPatternNames(c.pattern)) defines.add(n);
          collectDefines_ad(c.body, defines);
        }
        break;
      case 'Try':
        collectDefines_ad(node.body, defines);
        if (node.handlers) for (const h of node.handlers) {
          if (h.name) defines.add(h.name);
          if (h.body) collectDefines_ad(h.body, defines);
        }
        if (node.orelse) collectDefines_ad(node.orelse, defines);
        if (node.finalbody) collectDefines_ad(node.finalbody, defines);
        break;
    }
  }
}

// a comprehension's renames, less the names a function inside it binds itself
function _unshadowed(rename, names) {
  if (!rename || !rename.size) return rename;
  const out = new Map(rename);
  for (const n of names) if (n) out.delete(n);
  return out;
}
function collectTargetNames(target, defines) {
  if (!target) return;
  if (target.type === 'Name') { defines.add(target.id); return; }
  if (target.type === 'Tuple' || target.type === 'List') {
    for (const e of target.elts) collectTargetNames(e, defines);
    return;
  }
  if (target.type === 'Starred' && target.value) collectTargetNames(target.value, defines);
}

// ── Sync-function analysis ──
//
// Before any lowering, walk every top-level FunctionDef and decide whether
// it can be emitted as a plain `function` instead of `async function`.
//
// A function is "sync" if (a) its source body contains no `await` expression
// and no `yield`/`yield from`, and (b) every Call in its body whose callee
// is a bare Name resolves to either:
//   - itself (recursion is fine — registers self in the candidate set), or
//   - another function that is also sync (transitive).
//
// Method calls (`obj.x()`), attribute callees, lambdas, list/dict/set/gen
// comprehensions, and any non-Name callee (Attribute, Subscript, Call) are
// all conservatively treated as potentially-async — calling such a target
// disqualifies the enclosing function. Cheap to compute, easy to reason about,
// and `fib`-style recursion qualifies cleanly.
//
// The result is a Set<string> of sync function names. Adder lowering uses
// it to skip the `await` wrapping at known-safe call sites and to set
// `is_async: false` on the func_region.

function _astHasAwaitOrYield(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'Await' || node.type === 'Yield' || node.type === 'YieldFrom') {
    return true;
  }
  // Statements the lowerer itself lowers to an `await` in this body: a `+=` with an
  // in-place helper (_py.iadd may run an async __iadd__), `with` (__exit__ is awaited),
  // a class statement (members and class creation), imports, and a nested def's
  // decorators (applied here). Missing one made the function async while its call
  // sites were emitted sync — a `global` update then landed after the caller moved on.
  if (node.type === 'AugAssign' && IBINOP_HELPER[node.op]) return true;
  if (node.type === 'With' || node.type === 'AsyncWith' || node.type === 'ClassDef' ||
      node.type === 'Import' || node.type === 'ImportFrom' || node.type === 'Match') {
    return true;
  }
  // Don't descend into nested function definitions — their async-ness is
  // their own affair (but their decorators run in this body).
  if (node.type === 'FunctionDef' || node.type === 'AsyncFunctionDef') {
    return !!(node.decorators && node.decorators.length);
  }
  if (node.type === 'Lambda') return false;
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'line' || key === 'col') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) if (_astHasAwaitOrYield(item)) return true;
    } else if (v && typeof v === 'object') {
      if (_astHasAwaitOrYield(v)) return true;
    }
  }
  return false;
}

// `type(...)` with other than one argument builds a class — possibly through a metaclass
const _isTypeConstruction = (call) => call.func.type === 'Name' && call.func.id === 'type' && ((call.args || []).length !== 1 || (call.keywords || []).length > 0);

function _collectNameCallees(node, out, disqualifyRef) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDef' || node.type === 'AsyncFunctionDef' ||
      node.type === 'Lambda') {
    return;
  }
  if (node.type === 'Call') {
    if (node.func && node.func.type === 'Name') {
      // type(name, bases, ns) may run a metaclass written in Python (async): not a sync call
      if (_isTypeConstruction(node)) disqualifyRef.value = true;
      out.push(node.func.id);
    } else {
      // Non-Name callee (attribute, subscript, dynamic) — disqualifies the
      // enclosing function from sync.
      disqualifyRef.value = true;
    }
    // Still walk args / keywords below.
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'line' || key === 'col') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) _collectNameCallees(item, out, disqualifyRef);
    } else if (v && typeof v === 'object') {
      _collectNameCallees(v, out, disqualifyRef);
    }
  }
}

// Builtins that are definitively sync — i.e. they neither await internally
// nor iterate user iterables nor invoke user callables. Source of truth is
// ext/adder/src/builtins.js: anything declared without `async` and that
// doesn't reach into pyCollect/await is sync. Most primitive constructors,
// inspectors, and conversion helpers qualify; iteration / map / filter /
// list / tuple / dict / set / sorted / max / min / sum / any / all do NOT
// (they need `await pyCollect(...)` to handle async iterables).
//
// Keep this list in lockstep with builtins.js. A user who shadows one of
// these names at module scope (e.g. `async def sum`) is handled: the seed
// below skips names in ctx.defines, so the shadow's sync-ness comes from the
// analysis (or stays conservatively awaited) rather than this list.
const KNOWN_SYNC_BUILTINS = new Set([
  // primitive constructors / converters
  'int', 'float', 'str', 'bool', 'complex', 'bytes', 'chr', 'ord',
  // numeric helpers
  'abs', 'round', 'hex', 'oct', 'bin', 'pow',
  // inspectors
  'len', 'type', 'isinstance', 'issubclass', 'callable',
  'hasattr', 'getattr', 'setattr', 'delattr',
  'id', 'hash', 'repr', 'ascii',
  // iteration constructors that don't materialise — the iter object itself
  // is sync; consumers iterate it via _py.iter which is sync
  'range', 'iter',
  // I/O surfaces that return sync values (the underlying display may be
  // async but adder's `print` discards the result and returns null sync)
  'print',
  // misc
  'globals', 'locals', 'vars', 'dir',
  // exceptions (constructors)
  'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError',
  'AttributeError', 'NameError', 'StopIteration', 'StopAsyncIteration',
  'RuntimeError', 'ZeroDivisionError', 'NotImplementedError',
  'ImportError', 'ModuleNotFoundError', 'FileNotFoundError',
  'OSError', 'AssertionError', 'ArithmeticError', 'OverflowError',
]);

function analyseSyncFunctions(moduleStmts) {
  // Collect top-level FunctionDefs (only — we don't analyse nested defs;
  // they go through their own per-region analysis when their parent is lowered).
  const funcs = [];
  for (const stmt of moduleStmts) {
    if (stmt.type === 'FunctionDef' || stmt.type === 'AsyncFunctionDef') {
      const hasAwaitOrYield = _astHasAwaitOrYield({ type: 'Block', body: stmt.body });
      const callees = [];
      const disqualifyRef = { value: false };
      _collectNameCallees({ type: 'Block', body: stmt.body }, callees, disqualifyRef);
      // Decorators rewrite the binding to whatever the decorator returns —
      // could be async (e.g. @cached, @memoize that wrap with awaits, or any
      // user decorator). The source-level FunctionDef is one thing; the
      // bound name after decoration is another. We can't statically know
      // what shape the decorated value is, so we conservatively bail out
      // of sync classification.
      const decorated = (stmt.decorators && stmt.decorators.length > 0);
      funcs.push({
        name: stmt.name,
        disqualified: hasAwaitOrYield || disqualifyRef.value || decorated,
        callees,
      });
    } else if (stmt.type === 'ClassDef') {
      // A class is sync-callable when constructing it is: _py.createClass's constructor
      // returns the instance synchronously when __init__ does not return a Promise. So an
      // undecorated class with no bases (or only sync classes as bases) and an __init__
      // that is itself sync can be called without an await — which keeps the methods that
      // construct it (a value class's __add__ returning P(...)) sync too, so _py.add gets
      // an instance from them, not a Promise.
      const init = (stmt.body || []).find((m) => m.type === 'FunctionDef' && m.name === '__init__');
      const asyncInit = (stmt.body || []).some((m) => m.type === 'AsyncFunctionDef' && m.name === '__init__');
      const callees = [];
      const disqualifyRef = { value: false };
      let hasAwait = false;
      if (init) {
        hasAwait = _astHasAwaitOrYield({ type: 'Block', body: init.body }) || !!(init.decorators && init.decorators.length);
        _collectNameCallees({ type: 'Block', body: init.body }, callees, disqualifyRef);
      }
      const bases = stmt.bases || [];
      const nameBases = bases.filter((b) => b && b.type === 'Name' && b.id !== 'object');
      for (const b of nameBases) callees.push(b.id);
      funcs.push({
        name: stmt.name,
        // a __new__ decides construction itself (and is lowered async): not provably sync
        disqualified: asyncInit || hasAwait || disqualifyRef.value ||
          (stmt.body || []).some((m) => (m.type === 'FunctionDef' || m.type === 'AsyncFunctionDef') && m.name === '__new__') ||
          !!(stmt.decorators && stmt.decorators.length) || (stmt.keywords && stmt.keywords.length > 0) ||
          nameBases.length !== bases.filter((b) => !(b && b.type === 'Name' && b.id === 'object')).length,
        callees,
      });
    }
  }

  // All top-level FunctionDef names — used to decide "external callee".
  const allNames = new Set(funcs.map(f => f.name));

  // Initial candidate set: all functions not pre-disqualified.
  let sync = new Set();
  for (const f of funcs) if (!f.disqualified) sync.add(f.name);

  // Iterate: remove any function that calls a name we don't know is sync.
  // Known-sync builtins (range, len, int, abs, …) are accepted; other
  // external callees (imported, user-shadowed, async builtins like list /
  // sorted / map) are conservatively treated as async, since they go
  // through emitAwaitedCall_ad and produce an await op.
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of funcs) {
      if (!sync.has(f.name)) continue;
      for (const callee of f.callees) {
        // Self-recursion is fine: callee === f.name.
        if (callee === f.name) continue;
        // Other top-level FunctionDefs: must already be in sync.
        if (allNames.has(callee)) {
          if (!sync.has(callee)) { sync.delete(f.name); changed = true; break; }
          continue;
        }
        // Known-sync builtin — accepts.
        if (KNOWN_SYNC_BUILTINS.has(callee)) continue;
        // Anything else (imported, async builtins like sorted/map, params
        // shadowing as call targets) — conservatively async.
        sync.delete(f.name);
        changed = true;
        break;
      }
    }
  }
  return sync;
}

// ── Helper: call a _py runtime method (sync, no await needed) ──
//
// Thin wrapper over BaseLowerCtx.emitNamespacedCall — keeps the existing
// callsite ergonomics while sharing the AIR-shape implementation with
// soft (and any future frontend with a namespaced runtime).

// in sync mode (a sync-context dunder / property, or a sync twin) a call goes to the callee's
// sync twin when it has one: method calls, and calls of a value that may be any callable
const _SYNC_CALLS = { callMethod: 'callMethodSync', fnOf: 'fnOfSync', setattr: 'setattrSync', genExpr: 'genExprSync' };
function emitPyCall(ctx, method, args, loc, type) {
  if (Object.hasOwn(_SYNC_CALLS, method)) { ctx._modeDependent++; if (ctx._syncMode) method = _SYNC_CALLS[method]; }
  return ctx.emitNamespacedCall('_py', method, args, loc, type);
}

// Emit `_py.iter(src)`, with an `await` when the source value might be an
// async iterable. _iterArray (the runtime helper) returns a Promise<Array>
// for async iterables and a sync iterable otherwise; the await is correct
// for both shapes but forces the enclosing JS function to `async`, which
// would defeat the lowerer's syncFunctions optimization for the common
// case `for x in some_array` / `for x in nums` (varargs).
//
// Heuristic: only insert the await when `src` was itself an awaited call
// (a function call result — could be an async generator). Bare loads,
// constants, list/tuple/set literals, slices, etc. can't be async
// iterables in adder, so the sync path stays sync. Conservative on the
// safe side: if we miss an async-yielding case (e.g. value flowed through
// a Name binding), `for of` on the result iterates to zero items rather
// than crashing — debuggable but not catastrophic.
function emitPyIter(ctx, src, loc, type, helper = 'iter', extra = []) {
  const call = emitPyCall(ctx, helper, [src, ...extra], loc, type);
  // an awaited value, or a generator expression (its async variant), may be an async iterable,
  // which _py.iter collects behind a promise
  if (src && (src.op === 'await' || src._mayBeAsyncIter)) {
    return ctx.emit('await', [call.id], type || DYNAMIC, loc);
  }
  // in a function that may await anyway, any source may be async underneath (a user __iter__ /
  // __next__ that is itself async — `self.i += 1` in __next__ makes it so): guard the result as
  // `+=` does, `t = _py.iter(src); if (_py.isThen(t)) t = await t` — free there, and kept out
  // of sync functions, whose comprehensions take the synchronous reading only
  if (ctx._loopMayAwait) {
    const tmp = ctx.makeTempName('itr');
    ctx.emit('store', [tmp, call.id], VOID, loc);
    const isThen = emitPyCall(ctx, 'isThen', [ctx.emit('load', [tmp], DYNAMIC, loc)], loc, BOOL);
    const thenBody = captureOps(ctx, () => {
      const awaited = ctx.emit('await', [ctx.emit('load', [tmp], DYNAMIC, loc).id], DYNAMIC, loc);
      ctx.emit('store', [tmp, awaited.id], VOID, loc);
    });
    ctx.emit('if_region', [isThen.id], VOID, loc, { then_body: thenBody, else_body: [], phis: [] });
    return ctx.emit('load', [tmp], type || DYNAMIC, loc);
  }
  return call;
}

// User-facing calls (Python funcs / adder builtins) may be async — await them.
// Pass `sync: true` when the callee is statically known to be sync (e.g. a
// user FunctionDef that analyseSyncFunctions classified as sync); the await
// wrapping is then skipped, which is the difference between fib being a
// Promise-allocating loop and a tight sync recursion.
function emitAwaitedCall_ad(ctx, fnId, argIds, loc, type, opts) {
  const call = ctx.emit('call', [fnId, ...argIds], type || DYNAMIC, loc);
  if (opts && opts.sync) return call;
  return ctx.emit('await', [call.id], type || DYNAMIC, loc);
}

// ── Main entry ──

// opts.ticks: emit _py.tick(line) before every statement, for a run budget
// (statement count + wall clock) that holds in compiled code too.
export function lowerAdder(ast, source, opts) {
  // SSA id counter lives on the AdderLowerCtx instance now (via
  // BaseLowerCtx's _idGen); no module-level reset.
  const ctx = new AdderLowerCtx();
  ctx.source = source || null;
  ctx.ticks = !!(opts && opts.ticks);
  // opts.module = { package }: an imported module (not a cell). Relative imports resolve against
  // its package at compile time; its bindings are mirrored onto `__adder_module__`.
  if (opts && opts.module) {
    ctx.modulePackage = opts.module.package || '';
    // opts.module.isBuiltin(name): a free name that is no builtin is read checked (NameError when
    // nothing binds it); without the predicate every free name is taken as bound
    ctx.isBuiltin = opts.module.isBuiltin || null;
    ctx.moduleMirror = true;
    ctx.imports.add('__adder_module__');
  }

  if (ast.type !== 'Module') throw new AirLowerError('Expected Module node');
  // a compiled function can't take another body: a module that rewrites a function's __code__
  // runs on the tree-walker (its defaults it can: a def binds from a live defaults object)
  if (_rewritesFunctionInternals(ast)) throw new AirLowerError('rewriting __code__ needs the tree-walker');

  // globals() / locals(): the module's namespace as a live dict over the module object (a
  // compiled module mirrors every module-level binding onto it). The main program gets such an
  // object too — only when it calls them — and so does its mirroring. In such a program a
  // module-level name is read through the object first (_py.globalLoad), so a name created by
  // `globals()['x'] = …` is visible; programs that don't call them compile as before.
  // A module-level `from m import *` binds names known only at run time: the same — they land on
  // the module object (_py.starInto), and module-level names are read through it — so a name the
  // module defines and the star import replaces (bisect.py's `from _bisect import *` over its own
  // defs) reads as the import's.
  if (_callsScopeBuiltin(ast) || ast.body.some((st) => st && st.type === 'ImportFrom' && st.names.some((n) => n.name === '*'))) {
    ctx.usesGlobals = true;
    if (!ctx.moduleMirror) {
      const m = emitPyCall(ctx, 'mainModule', [], null);
      ctx.emit('store', ['__adder_module__', m.id], VOID, null);
      ctx.symbols.set('__adder_module__', m.id);
      ctx.moduleMirror = true;
    }
  }

  // Collect all module-scope defines up front (Python module-scope semantics)
  collectDefines_ad(ast.body, ctx.defines);
  // ... and the names functions declare `global`: assigned from a function, they are module
  // variables even if the top level never assigns them (`global done; done = True`)
  (function globalsIn(stmts, inFn) {
    for (const st of stmts || []) {
      if (!st || typeof st !== 'object') continue;
      if (st.type === 'Global' && inFn) for (const n of st.names) ctx.defines.add(n);
      const fn = st.type === 'FunctionDef' || st.type === 'AsyncFunctionDef';
      for (const k of ['body', 'orelse', 'finalbody']) if (Array.isArray(st[k])) globalsIn(st[k], inFn || fn || st.type === 'ClassDef');
      if (Array.isArray(st.handlers)) for (const h of st.handlers) globalsIn(h.body, inFn);
      if (Array.isArray(st.cases)) for (const c of st.cases) globalsIn(c.body, inFn);
    }
  })(ast.body, false);

  // Pre-analyse top-level FunctionDefs to determine which are sync — done
  // before any body is lowered, so recursive call sites and forward
  // references inside other functions can take the no-await fast path.
  // (not in a module with a star import: any of its names — its own defs, a builtin — may be
  // replaced by what the import brings, a function that isn't sync)
  const hasStar = ast.body.some((st) => st && st.type === 'ImportFrom' && st.names.some((n) => n.name === '*'));
  if (!hasStar) for (const name of analyseSyncFunctions(ast.body)) {
    ctx.syncFunctions.add(name);
  }
  // Seed known-sync builtins (range, len, int, abs, …) into the same set so
  // module-level loops like `for i in range(10000)` skip the await on
  // range itself. This is the difference between sum-1..10000 still
  // having an await at iter-construction and being fully sync.
  for (const name of KNOWN_SYNC_BUILTINS) {
    // Don't let the builtin seed shadow a user who redefined the name at
    // module scope (e.g. `async def sum`). For a shadowed name, sync-ness
    // comes from analyseSyncFunctions above (or stays conservatively async →
    // awaited). Seeding it sync unconditionally would skip the await on an
    // async shadow → a Promise leaks through as the value.
    if (!ctx.defines.has(name) && !hasStar) ctx.syncFunctions.add(name);
  }

  // Identify names that will be declared by `function`/`class` syntax —
  // those don't need (and can't have) a `let` pre-declaration.
  const funcOrClassNames = new Set();
  ctx.funcOrClassNames = funcOrClassNames;   // module-level def/class names: provably callable
  // (provably a plain function or class, called directly: only an undecorated one — a decorator
  // may rebind the name to any callable, `@click.command()` to a Command with __call__)
  ctx.knownCallables = new Set();
  for (const stmt of ast.body) {
    if ((stmt.type === 'FunctionDef' || stmt.type === 'AsyncFunctionDef' ||
         stmt.type === 'ClassDef') && stmt.name) {
      funcOrClassNames.add(stmt.name);
      if (!(stmt.decorators && stmt.decorators.length) && stmt.type !== 'AsyncFunctionDef') ctx.knownCallables.add(stmt.name);
    }
  }

  // Pre-declare every module-level define with `let name;` at the top.
  // This ensures variables defined in nested blocks are visible at module scope.
  for (const name of ctx.defines) {
    if (name === '__lastExpr__') continue;
    if (funcOrClassNames.has(name)) continue; // declared by function/class syntax
    const undef = ctx.emit('const', [undefined], VOID, null);
    ctx.emit('store', [name, undef.id], VOID, null);
    ctx.symbols.set(name, undef.id);
  }

  ctx._loopMayAwait = true;   // cell-level code is async
  // Lower each statement; the module's LAST statement, when an expression, is its display value
  // (an earlier expression must not be: its call would be inlined at the store, after the
  // statements that follow it)
  let lastExpr = null;
  for (const stmt of ast.body) {
    const result = lowerStmt_ad(ctx, stmt);
    lastExpr = stmt.type === 'Expr' && result ? result.id : null;
  }

  // the unit's call-site slot table, made first thing when it runs (its size known only now)
  if (ctx._callSiteId) {
    const at = ctx.ops.length;
    const n = ctx.emit('const', [ctx._callSiteId], I32, null);
    const t = emitPyCall(ctx, 'pics', [n], null);
    ctx.emit('store', ['$pic', t.id], VOID, null);
    ctx.ops.unshift(...ctx.ops.splice(at));
  }

  // If there's a trailing Expr, store it as __lastExpr__ so the caller can read it
  if (lastExpr) {
    ctx.emit('store', ['__lastExpr__', lastExpr], VOID, null);
    ctx.symbols.set('__lastExpr__', lastExpr);
    ctx.defines.add('__lastExpr__');
  }

  // Build cell module (matching shape from lowerJS)
  const exports = new Map();
  for (const name of ctx.defines) {
    const ssaId = ctx.symbols.get(name);
    const type = ssaId ? (ctx.types.get(ssaId) || DYNAMIC) : DYNAMIC;
    exports.set(jsSafeName(name), { ssa_name: ssaId || null, type });
  }

  return {
    ops: ctx.ops,
    // ctx.symbols is a ScopeChain post-base-extraction; flatten to a Map
    // for downstream consumers (validator, debug tools).
    symbol_table: ctx.symbols.flatten(),
    exports,
    imports: new Set([...ctx.imports].map(jsSafeName)),
    defines: new Set([...ctx.defines].map(jsSafeName)),
    side_effects: true,
    _lastExpr: lastExpr,
  };
}

// ── Statement lowering ──

function lowerStmt_ad(ctx, node) {
  if (!node) return null;
  const l = ctx.loc(node);
  if (ctx.ticks && node.line != null) {
    const ln = ctx.emit('const', [node.line], DYNAMIC, l);
    emitPyCall(ctx, 'tick', [ln], l, VOID);
  }

  switch (node.type) {
    case 'Pass': return null;
    case 'Break':
      // for/else and while/else desugaring: when an enclosing loop with
      // an `else` clause registered a breakHook, fire it before the break
      // so the orelse block is skipped on this exit path.
      if (ctx.breakHook) ctx.breakHook(l);
      ctx.emit('break', [], VOID, l);
      return null;
    case 'Continue': ctx.emit('continue', [], VOID, l); return null;
    case 'Expr': return lowerExpr_ad(ctx, node.value);

    case 'Assign': return lowerAssign(ctx, node);
    case 'AugAssign': return lowerAugAssign(ctx, node);
    case 'AnnAssign': return lowerAnnAssign(ctx, node);
    case 'Delete': return lowerDelete(ctx, node);

    case 'Return': {
      const val = node.value ? lowerExpr_ad(ctx, node.value) : ctx.emit('const', [null], VOID, l);
      ctx.emit('return', [val.id], VOID, l);
      return null;
    }

    case 'If': return lowerIf_ad(ctx, node);
    case 'For': return lowerFor_ad(ctx, node);
    case 'While': return lowerWhile_ad(ctx, node);

    case 'FunctionDef':
    case 'AsyncFunctionDef':
      return lowerFuncDef(ctx, node);

    case 'Import': return lowerImport(ctx, node);
    case 'ImportFrom': return lowerImportFrom(ctx, node);

    case 'ClassDef':
      return lowerClassDef(ctx, node);

    case 'Try':
      return lowerTry_ad(ctx, node);

    case 'With':
    case 'AsyncWith':
      return lowerWith(ctx, node);

    case 'Raise': {
      if (!node.exc) {
        // bare raise: the exception this handler is handling, else Python's RuntimeError
        if (ctx._excName) ctx.emit('throw', [ctx.emit('load', [ctx._excName], DYNAMIC, l).id], VOID, l);
        else emitPyCall(ctx, 'reraise', [], l, VOID);
        return null;
      }
      const exc = lowerExpr_ad(ctx, node.exc);
      if (node.hasCause) emitPyCall(ctx, 'raise', [exc, lowerExpr_ad(ctx, node.cause)], l, VOID);
      else emitPyCall(ctx, 'raise', [exc], l, VOID);
      return null;
    }

    case 'Assert': {
      // assert test, msg → if not _py.truthy(test) throw AssertionError(msg)
      const test = lowerExpr_ad(ctx, node.test);
      const truthy = emitPyCall(ctx, 'truthy', [test], l, BOOL);
      // if (!truthy) raise AssertionError
      const thenBody = captureOps(ctx, () => {
        if (node.msg) emitPyCall(ctx, 'assertFail', [lowerExpr_ad(ctx, node.msg)], l, VOID);
        else emitPyCall(ctx, 'assertFail', [], l, VOID);
      });
      // Emit: if (!_py.truthy(test)) { raise msg }
      const notTruthy = ctx.emit('logical_not', [truthy.id], BOOL, l);
      ctx.emit('if_region', [notTruthy.id], VOID, l, {
        then_body: thenBody, else_body: [], phis: [],
      });
      return null;
    }

    case 'Match': return lowerMatch(ctx, node);

    case 'Global':
    case 'Nonlocal':
      if (node.type === 'Global' && ctx._fnGlobals) for (const n of node.names) ctx._fnGlobals.add(n);
      // Declaration-only; mark names as already declared so stores don't re-declare.
      // With per-function scope tracking in the emitter, a bare `x = ...` inside
      // the function reassigns the outer binding (global/nonlocal semantics).
      for (const n of node.names) {
        // Track in ctx.symbols to signal "this name exists in enclosing scope"
        if (!ctx.symbols.has(n)) ctx.symbols.set(n, null);
        // Emit a special opaque that marks `decl:name` as set in emitter scope
        ctx.emit('opaque', [`/* ${node.type.toLowerCase()} ${n} */`], VOID, l, { _markDeclared: n, rebinds: jsSafeName(n) });
      }
      return null;

    default:
      throw new AirLowerError(`unsupported statement: ${node.type}`);
  }
}

// ── Expression lowering ──

function lowerExpr_ad(ctx, node) {
  if (!node) return ctx.emit('const', [null], VOID, null);
  const l = ctx.loc(node);

  switch (node.type) {
    case 'Constant': {
      const v = node.value;
      if (v === null) return ctx.emit('const', [null], DYNAMIC, l);
      if (typeof v === 'boolean') return ctx.emit('const', [v], BOOL, l);
      if (typeof v === 'number') {
        const isInt = Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
        return ctx.emit('const', [v], isInt ? I32 : F64, l);
      }
      if (typeof v === 'string') return ctx.emit('const', [v], STRING, l);
      // an imaginary literal (2j): a complex made at run time
      if (v && typeof v === 'object' && v._complex) return emitPyCall(ctx, 'imag', [ctx.emit('const', [v.imag], F64, l)], l);
      return ctx.emit('const', [v], DYNAMIC, l);
    }

    case 'Name': {
      const name = node.id;
      if (name === 'True') return ctx.emit('const', [true], BOOL, l);
      if (name === 'False') return ctx.emit('const', [false], BOOL, l);
      if (name === 'None') return ctx.emit('const', [null], DYNAMIC, l);
      // Decide whether this Name needs to come from upstream scope:
      //   - already assigned in this scope (ctx.symbols.has)  → load local
      //   - inside a function/class body referencing a name defined
      //     later at module level (forward ref) → load via closure, no import
      //   - at module level and not yet assigned                → import from
      //     upstream (covers `df = df.rename(...)` re-bind pattern)
      if (name === '__class__') {
        const cell = _classCellRef(ctx);
        if (cell) return emitPyCall(ctx, 'cellGet', [ctx.emit('load', [cell], DYNAMIC, l)], l);
      }
      const isForwardRef = !ctx.topLevel && ctx.defines.has(name);
      const free = !ctx.symbols.has(name) && !isForwardRef;
      if (free) ctx.imports.add(name);
      let raw = ctx.emit('load', [name], DYNAMIC, l);
      if (ctx.usesGlobals && name !== '__adder_module__' && _resolvesToModule(ctx, name)) {
        raw = emitPyCall(ctx, 'globalLoad', [ctx.emit('load', ['__adder_module__'], DYNAMIC, l), ctx.emit('const', [name], STRING, l), raw], l);
      }
      if (free && ctx.isBuiltin && name !== '__adder_module__' && !ctx.defines.has(name) && !ctx.isBuiltin(name)) {
        raw = emitPyCall(ctx, 'freeName', [raw, ctx.emit('const', [name], STRING, l)], l);
      }
      return raw;
    }

    case 'BinOp': return lowerBinOp_ad(ctx, node);
    case 'UnaryOp': return lowerUnaryOp(ctx, node);
    case 'BoolOp': return lowerBoolOp(ctx, node);
    case 'Compare': return lowerCompare_ad(ctx, node);

    case 'Call': return lowerCall_ad(ctx, node);

    case 'Attribute': {
      const obj = lowerExpr_ad(ctx, node.value);
      const name = ctx.emit('const', [node.attr], STRING, l);
      return emitPyCall(ctx, 'getattr', [obj, name], l);
    }

    case 'Subscript': return lowerSubscript(ctx, node);

    case 'List': return lowerListOrTuple(ctx, node);
    case 'Tuple': return emitPyCall(ctx, 'tuple', [lowerListOrTuple(ctx, node)], l);

    case 'Dict': {
      // A literal with **unpacking builds at run time (_py.dictLiteral): the sources may be
      // Maps or plain dicts, and the keys decide the representation. (The Map path below
      // dropped the unpack's key slot and misaligned keys and values.)
      if (node.keys.some(k => k === null)) {
        const keys = node.keys.map(k => (k ? lowerExpr_ad(ctx, k) : ctx.emit('const', [null], DYNAMIC, l)).id);
        const values = node.values.map(v => lowerExpr_ad(ctx, v).id);
        const spreads = node.keys.map(k => ctx.emit('const', [k === null], BOOL, l).id);
        return emitPyCall(ctx, 'dictLiteral', [
          ctx.emit('array_new', keys, DYNAMIC, l), ctx.emit('array_new', values, DYNAMIC, l),
          ctx.emit('array_new', spreads, DYNAMIC, l)], l);
      }
      // Plain object if all keys are string constants; otherwise build a Map.
      // Plain object if all keys are string constants (JS cells read d.a); otherwise, and
      // for an empty literal, a PyDict via _py.makeDict (see eval.js)
      const allStringKeys = node.keys.length > 0 && node.keys.every(k =>
        k && k.type === 'Constant' && plainObjectKey(k.value));
      if (allStringKeys) {
        const pairs = [];
        for (let i = 0; i < node.keys.length; i++) {
          if (node.keys[i] === null) {
            // **unpack
            const src = lowerExpr_ad(ctx, node.values[i]);
            pairs.push({ spread: true, id: src.id });
          } else {
            const val = lowerExpr_ad(ctx, node.values[i]);
            pairs.push({ key: node.keys[i].value, id: val.id });
          }
        }
        return ctx.emit('object_new', pairs, DYNAMIC, l);
      }
      // Build a Map via _py.makeDict with arrays of keys and values
      const keys = node.keys.map(k => k ? lowerExpr_ad(ctx, k).id : null);
      const values = node.values.map(v => lowerExpr_ad(ctx, v).id);
      const keysArr = ctx.emit('array_new', keys.filter(k => k), DYNAMIC, l);
      const valsArr = ctx.emit('array_new', values, DYNAMIC, l);
      return emitPyCall(ctx, 'makeDict', [keysArr, valsArr], l);
    }

    case 'Set': return emitPyCall(ctx, 'makeSet', [lowerListOrTuple(ctx, node)], l);   // starred items spread, as in a list

    case 'SetComp':
    case 'DictComp':
    case 'GeneratorExp':
      return lowerComprehension(ctx, node);

    case 'IfExp': {
      // a if cond else b — ternary
      const cond = lowerExpr_ad(ctx, node.test);
      const truthy = ctx.truthy(cond, l);
      return emitPhiSelect(ctx, truthy.id,
        () => lowerExpr_ad(ctx, node.body),
        () => lowerExpr_ad(ctx, node.orelse),
        l, DYNAMIC);
    }

    case 'JoinedStr': {
      // f-string — concat parts
      let result = ctx.emit('const', [''], STRING, l);
      for (const part of node.values) {
        let piece;
        if (part.type === 'Constant') {
          piece = ctx.emit('const', [part.value], STRING, l);
        } else if (part.type === 'FormattedValue') {
          let val = lowerExpr_ad(ctx, part.value);
          // {x!r} / {x!a} / {x!s}: convert before formatting
          if (part.conversion === 'r' || part.conversion === 'a') val = emitPyCall(ctx, 'repr', [val], l, STRING);
          else if (part.conversion === 's') val = emitPyCall(ctx, 'str', [val], l, STRING);
          let spec;
          if (part.formatSpec == null) {
            spec = ctx.emit('const', [''], STRING, l);
          } else if (typeof part.formatSpec === 'string') {
            // adder parser emits formatSpec as a raw string (e.g. ".2f")
            spec = ctx.emit('const', [part.formatSpec], STRING, l);
          } else {
            spec = lowerExpr_ad(ctx, part.formatSpec);
          }
          piece = emitPyCall(ctx, 'fmt', [val, spec], l, STRING);
        } else {
          throw new AirLowerError(`unexpected JoinedStr part: ${part.type}`);
        }
        result = ctx.emit('add', [result.id, piece.id], STRING, l);
      }
      return result;
    }

    case 'Lambda': return lowerLambda(ctx, node);
    case 'Bytes': return emitPyCall(ctx, 'bytesLit', [ctx.emit('const', [node.value], STRING, l)], l);

    case 'ListComp': return lowerComprehension(ctx, node);

    case 'Await': {
      // through _py.aw: an object with __await__ (an asyncio Task) is awaited via it
      const val = emitPyCall(ctx, 'aw', [lowerExpr_ad(ctx, node.value)], l);
      return ctx.emit('await', [val.id], DYNAMIC, l);
    }

    case 'NamedExpr': {
      // walrus: (name := value) — assign then evaluate as the value
      const val = lowerExpr_ad(ctx, node.value);
      const name = node.target.id;
      ctx.emit('store', [name, val.id], VOID, l);
      ctx.symbols.set(name, val.id);
      if (ctx.topLevel) ctx.defines.add(name);
      return val;
    }

    case 'Starred':
      throw new AirLowerError('starred expression in unsupported position');

    case 'Yield': {
      const val = node.value ? lowerExpr_ad(ctx, node.value) : null;
      return ctx.emit('yield', val ? [val.id] : [], DYNAMIC, l);
    }
    case 'YieldFrom': {
      // (through _py.yieldFrom: PEP 380 for any iterator — JS yield* alone speaks only JS's)
      const val = lowerExpr_ad(ctx, node.value);
      return ctx.emit('yield_delegate', [emitPyCall(ctx, 'yieldFrom', [val], l).id], DYNAMIC, l);
    }

    default:
      throw new AirLowerError(`unsupported expression: ${node.type}`);
  }
}

// ── Binary/unary/bool/compare ops ──

const BINOP_HELPER = {
  '+': 'add', '-': 'sub', '*': 'mul', '/': 'div',
  '//': 'floordiv', '%': 'mod', '**': 'pow',
  '&': 'and_', '|': 'or_', '^': 'xor',  // bitwise — Python has __and__ etc.
  '<<': 'lshift', '>>': 'rshift',
};

function lowerBinOp_ad(ctx, node) {
  const l = ctx.loc(node);
  const lhs = lowerExpr_ad(ctx, node.left);
  const rhs = lowerExpr_ad(ctx, node.right);
  const op = node.op;

  // All operators go through _py helpers (Python semantics: bools as ints, sets, exact past
  // 32 bits); the specialization pass turns integer-typed bitwise ops back into raw ones.
  // &, |, ^ go through `_py.and_` / `or_` / `xor` so dunder methods
  // (`__and__`, `__or__`, `__xor__`) fire — sadpan's BooleanMask combines
  // via these. The runtime helpers fast-path to native bitwise when both
  // operands are real ints, so this isn't a perf hit for normal int code.

  const helper = BINOP_HELPER[op];
  if (!helper) throw new AirLowerError(`unsupported binop: ${op}`);
  return emitPyCall(ctx, helper, [lhs, rhs], l);
}

function lowerUnaryOp(ctx, node) {
  const l = ctx.loc(node);
  const arg = lowerExpr_ad(ctx, node.operand);
  const op = node.op;
  if (op === 'not') {
    // not x → !_py.truthy(x)
    const truthy = emitPyCall(ctx, 'truthy', [arg], l, BOOL);
    return ctx.emit('logical_not', [truthy.id], BOOL, l);
  }
  if (op === '-') return emitPyCall(ctx, 'neg', [arg], l);
  if (op === '+') return emitPyCall(ctx, 'pos', [arg], l);
  if (op === '~') return emitPyCall(ctx, 'invert', [arg], l);
  throw new AirLowerError(`unsupported unary op: ${op}`);
}

function lowerBoolOp(ctx, node) {
  // and / or — short-circuit. Python semantics: return the actual value, not a bool.
  // x and y → (_py.truthy(x) ? y : x)
  // x or y  → (_py.truthy(x) ? x : y)
  // For n-ary, chain: a and b and c → a_and_b-result and c
  const l = ctx.loc(node);
  if (node.values.length < 2) return lowerExpr_ad(ctx, node.values[0]);

  let result = lowerExpr_ad(ctx, node.values[0]);
  for (let i = 1; i < node.values.length; i++) {
    const truthy = ctx.truthy(result, l);
    // and: if truthy(prev) → next else → prev
    // or:  if truthy(prev) → prev else → next
    // The "identity" branch returns prev without emitting anything;
    // emitPhiSelect runs both callbacks inside captureOps so the
    // non-identity branch's lowerExpr_ad becomes its body.
    const prev = result;
    result = emitPhiSelect(ctx, truthy.id,
      node.op === 'and' ? () => lowerExpr_ad(ctx, node.values[i]) : () => prev,
      node.op === 'and' ? () => prev : () => lowerExpr_ad(ctx, node.values[i]),
      l, DYNAMIC);
  }
  return result;
}

const CMP_HELPER = {
  '==': 'eq', '!=': 'neq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte',
};

function lowerCompare_ad(ctx, node) {
  const l = ctx.loc(node);
  // Chained compare: a < b < c → (a < b) && (b < c)
  // Note: Python evaluates b only once, but for simplicity we re-evaluate it.
  // This is observable but rare in practice.
  let left = lowerExpr_ad(ctx, node.left);
  let result = null;
  for (let i = 0; i < node.ops.length; i++) {
    const op = node.ops[i];
    const right = lowerExpr_ad(ctx, node.comparators[i]);

    let cmp;
    if (op === 'in') {
      cmp = emitPyCall(ctx, 'contains', [right, left], l, BOOL);
    } else if (op === 'not in') {
      const c = emitPyCall(ctx, 'contains', [right, left], l, BOOL);
      cmp = ctx.emit('logical_not', [c.id], BOOL, l);
    } else if ((op === 'is' || op === 'is not') && (_isNoneLit(node.comparators[i]) || _isNoneLit(i === 0 ? node.left : node.comparators[i - 1]))) {
      // `x is None`: JS undefined (a function that fell off its end, a missing slot) is None too
      const other = _isNoneLit(node.comparators[i]) ? left : right;
      cmp = emitPyCall(ctx, 'isNone', [other], l, BOOL);
      if (op === 'is not') cmp = ctx.emit('logical_not', [cmp.id], BOOL, l);
    } else if (op === 'is') {
      cmp = ctx.emit('eq', [left.id, right.id], BOOL, l);
    } else if (op === 'is not') {
      cmp = ctx.emit('neq', [left.id, right.id], BOOL, l);
    } else {
      const helper = CMP_HELPER[op];
      if (!helper) throw new AirLowerError(`unsupported compare: ${op}`);
      cmp = emitPyCall(ctx, helper, [left, right], l, BOOL);
    }

    result = result ? ctx.emit('logical_and', [result.id, cmp.id], BOOL, l) : cmp;
    left = right;
  }
  return result;
}

// ── Subscript ──

function lowerSubscript(ctx, node) {
  const l = ctx.loc(node);
  const obj = lowerExpr_ad(ctx, node.value);
  if (node.slice.type === 'Slice') {
    const lower = node.slice.lower ? lowerExpr_ad(ctx, node.slice.lower) : ctx.emit('const', [null], VOID, l);
    const upper = node.slice.upper ? lowerExpr_ad(ctx, node.slice.upper) : ctx.emit('const', [null], VOID, l);
    const step = node.slice.step ? lowerExpr_ad(ctx, node.slice.step) : ctx.emit('const', [null], VOID, l);
    return emitPyCall(ctx, 'slice', [obj, lower, upper, step], l);
  }
  if (node.slice.type === 'Tuple' && node.slice.elts.some((e) => e.type === 'Starred') && !node.slice.elts.some((e) => e.type === 'Slice')) {
    // x[*a, b] (3.11): the key is the tuple display, starred items spliced in
    return emitPyCall(ctx, 'getitem', [obj, lowerExpr_ad(ctx, node.slice)], l);
  }
  if (node.slice.type === 'Tuple') {
    // numpy / pandas multi-dim subscript — build an array of evaluated
    // items (Slice elements become `_py.makeSlice(lo, hi, step)` marker
    // objects) and pass it to `_py.getitem`. The target __getitem__
    // (natra ndarray, DataFrame, etc.) interprets the array as a tuple.
    const elts = node.slice.elts.map(elt => _lowerSliceElt(ctx, elt, l));
    const arr = ctx.emit('array_new', elts.map(e => e.id), DYNAMIC, l);
    const tupleKey = emitPyCall(ctx, 'tuple', [arr], l);
    return emitPyCall(ctx, 'getitem', [obj, tupleKey], l);
  }
  const key = lowerExpr_ad(ctx, node.slice);
  return emitPyCall(ctx, 'getitem', [obj, key], l);
}

// Lower one element of a tuple subscript: a Slice becomes a runtime
// `_py.makeSlice` call; anything else lowers as a normal expression.
function _lowerSliceElt(ctx, elt, l) {
  if (elt && elt.type === 'Slice') {
    const lower = elt.lower ? lowerExpr_ad(ctx, elt.lower) : ctx.emit('const', [null], VOID, l);
    const upper = elt.upper ? lowerExpr_ad(ctx, elt.upper) : ctx.emit('const', [null], VOID, l);
    const step = elt.step ? lowerExpr_ad(ctx, elt.step) : ctx.emit('const', [null], VOID, l);
    return emitPyCall(ctx, 'makeSlice', [lower, upper, step], l);
  }
  return lowerExpr_ad(ctx, elt);
}

const _isNoneLit = (n) => !!n && n.type === 'Constant' && n.value === null;

// ── Call ──

function lowerCall_ad(ctx, node) {
  const l = ctx.loc(node);

  // eval / exec without namespaces run against the caller's live scope, which only the
  // tree-walker has; given a globals dict (positionally or by keyword) they're ordinary calls
  if (node.func.type === 'Name' && (node.func.id === 'eval' || node.func.id === 'exec') && !ctx.symbols.has(node.func.id)) {
    const hasGlobals = node.args.length >= 2 || (node.keywords || []).some((k) => (k.name || k.arg) === 'globals');
    // without them, CPython runs it in globals() and locals() — so this does too (the source can
    // read the module's and the function's names; what it binds lands in those dicts)
    if (!hasGlobals) {
      if (node.args.length !== 1 || (node.keywords || []).some((k) => (k.name || k.arg) === 'locals')) throw new AirLowerError(`${node.func.id}() needs the tree-walker`);
      const scopeCall = (id) => ({ type: 'Call', func: { type: 'Name', id, line: node.line }, args: [], keywords: [], line: node.line });
      return lowerCall_ad(ctx, { ...node, args: [node.args[0], scopeCall('globals'), scopeCall('locals')] });
    }
  }
  // globals(): the module's live namespace. locals(): at module level the same; in a function a
  // snapshot of its bound locals; in a class body (rare) the tree-walker's
  if (node.func.type === 'Name' && (node.func.id === 'globals' || node.func.id === 'locals') && !ctx.symbols.has(node.func.id) && !node.args.length) {
    const atModule = !ctx._fnLocalNames;
    if (node.func.id === 'locals' && !atModule) {
      const names = ctx._fnLocalNames.filter((n) => ctx.symbols.has(n));
      return emitPyCall(ctx, 'localsOf', [
        ctx.emit('array_new', names.map((n) => ctx.emit('const', [n], STRING, l).id), DYNAMIC, l),
        ctx.emit('array_new', names.map((n) => ctx.emit('load', [n], DYNAMIC, l).id), DYNAMIC, l)], l);
    }
    if (node.func.id === 'locals' && ctx._classBodyOf) throw new AirLowerError('locals() in a class body needs the tree-walker');
    return emitPyCall(ctx, 'globalsOf', [ctx.emit('load', ['__adder_module__'], DYNAMIC, l)], l);
  }

  // super() / super(Class, obj): `super` is reserved in JS, so it never becomes a free name
  if (node.func.type === 'Name' && node.func.id === 'super' && !ctx.symbols.has('super') && !(node.keywords || []).length) {
    if (node.args.length === 0) {
      // CPython's: the function's first argument, and the `__class__` cell it sees
      const sc = ctx._superCtx;
      if (sc && sc.varargSelf) throw new AirLowerError('super() with *args self needs the tree-walker');
      if (!sc || sc.noArgs) return emitPyCall(ctx, 'raiseRuntime', [ctx.emit('const', ['super(): no arguments'], STRING, l)], l);
      const cell = sc.cell ? ctx.emit('load', [sc.cell], DYNAMIC, l) : ctx.emit('const', [null], VOID, l);
      const self = ctx.emit('load', [ctx._superCtx.self], DYNAMIC, l);
      return emitPyCall(ctx, 'superCell', [cell, self], l);
    }
    if (!node.args.some((a) => a.type === 'Starred')) return emitPyCall(ctx, 'super', node.args.map((a) => lowerExpr_ad(ctx, a)), l);
  }

  const hasStarred = node.args.some(a => a.type === 'Starred');
  const hasKwargs = node.keywords && node.keywords.length > 0;
  const hasSplatKw = hasKwargs && node.keywords.some(kw => kw.name === null);

  // Lower positional args, spreading any starred ones
  const argIds = [];
  for (const a of node.args) {
    if (a.type === 'Starred') {
      const inner = lowerExpr_ad(ctx, a.value);
      // Emit spread on the iter-converted value so JS ...spread works
      const arr = emitPyCall(ctx, 'iter', [inner], l);
      argIds.push(ctx.emit('spread', [arr.id], DYNAMIC, l).id);
    } else {
      argIds.push(lowerExpr_ad(ctx, a).id);
    }
  }

  // Build kwargs if present
  let kwObjId = null;
  if (hasKwargs) {
    const pairs = [];
    let hasSplat = false;
    for (const kw of node.keywords) {
      if (kw.name === null) {
        // **kw splat
        hasSplat = true;
        const src = emitPyCall(ctx, 'kwSplat', [lowerExpr_ad(ctx, kw.value)], l);
        pairs.push({ spread: true, id: src.id });
      } else {
        const val = lowerExpr_ad(ctx, kw.value);
        pairs.push({ key: kw.name, id: val.id });
      }
    }
    // Always include _kw: true marker (for adder's calling convention)
    pairs.unshift({ key: '_kw', id: ctx.emit('const', [true], BOOL, l).id });
    kwObjId = ctx.emit('object_new', pairs, DYNAMIC, l).id;
  }

  // Assemble final call. Skip the await when the callee is a Name that
  // analyseSyncFunctions classified as sync — that's the path that makes
  // recursive integer-only functions (fib, ackermann, etc.) actually fast.
  if (node.func.type === 'Attribute') {
    // Fused method call via PIC: `_py.callMethod(obj, name, siteId, ...args)`
    // skips the getattr → bound-method closure → call dance that the legacy
    // emit used. siteId is per-call-site so the runtime cache stays
    // monomorphic for sites that always see the same receiver type.
    const obj = lowerExpr_ad(ctx, node.func.value);
    const nameOp = ctx.emit('const', [node.func.attr], STRING, l);
    const siteOp = ctx.emit('array_get', [ctx.emit('load', ['$pic'], DYNAMIC, l).id, ctx.emit('const', [ctx.nextCallSiteId()], I32, l).id], DYNAMIC, l);
    const callArgs = [obj, nameOp, siteOp];
    for (const id of argIds) callArgs.push({ id });
    if (kwObjId) callArgs.push({ id: kwObjId });
    const call = emitPyCall(ctx, 'callMethod', callArgs, l);
    return ctx.emit('await', [call.id], DYNAMIC, l);
  }

  const isSyncCallee =
    node.func.type === 'Name' &&
    !hasStarred && !hasKwargs &&
    ctx.syncFunctions.has(node.func.id) && !_isTypeConstruction(node);

  // a callee that isn't provably a function (a variable, a call's result, a subscript) may be an
  // object with __call__: _py.fnOf gives its bound __call__ (a function passes through as is)
  let fn = lowerExpr_ad(ctx, node.func);
  const id = node.func.type === 'Name' ? node.func.id : null;
  const knownFn = id !== null && (
    (ctx.knownCallables && ctx.knownCallables.has(id)) ||                            // a module-level (undecorated) def / class
    (KNOWN_SYNC_BUILTINS.has(id) && !ctx.symbols.has(id) && !ctx.defines.has(id)));   // an unshadowed builtin
  if (!knownFn) fn = emitPyCall(ctx, 'fnOf', [fn], l);
  // a module-level def / class called from sync mode: its twin / a synchronous construction
  else if (ctx._syncMode && !isSyncCallee && ctx.knownCallables && ctx.knownCallables.has(id)) fn = emitPyCall(ctx, 'syncOf', [fn], l);
  const finalArgs = kwObjId ? [...argIds, kwObjId] : argIds;
  return emitAwaitedCall_ad(ctx, fn.id, finalArgs, l, undefined, { sync: isSyncCallee });
}

// ── Assignment ──

function lowerAssign(ctx, node) {
  const l = ctx.loc(node);
  const tgt = node.targets.length === 1 ? node.targets[0] : null;
  const src = node.value;
  if (tgt && (tgt.type === 'Tuple' || tgt.type === 'List') && src && (src.type === 'Tuple' || src.type === 'List') &&
      tgt.elts.length === src.elts.length && !tgt.elts.some((e) => e.type === 'Starred') && !src.elts.some((e) => e.type === 'Starred')) {
    const vals = src.elts.map((e) => {
      const v = lowerExpr_ad(ctx, e);
      // materialise each value before any store (a, b = b, a + b reads the old a and b)
      return ctx.emit('load', [_refExpr(ctx, v.id)], DYNAMIC, l);
    });
    tgt.elts.forEach((t, i) => lowerAssignTarget(ctx, t, vals[i], l));
    return null;
  }
  const value = lowerExpr_ad(ctx, node.value);
  for (const target of node.targets) {
    lowerAssignTarget(ctx, target, value, l);
  }
  return null;
}

function lowerAssignTarget(ctx, target, value, l) {
  if (target.type === 'Name') {
    const name = target.id;
    // `nonlocal __class__; __class__ = X` in a method rebinds the class's cell
    if (name === '__class__' && !ctx._classBodyOf) {
      const cell = _classCellRef(ctx);
      if (cell) { emitPyCall(ctx, 'cellSet', [ctx.emit('load', [cell], DYNAMIC, l), value], l); return; }
    }
    ctx.emit('store', [name, value.id], VOID, l);
    ctx.symbols.set(name, value.id);
    if (ctx.topLevel && !ctx._compDepth) ctx.defines.add(name);
    return;
  }
  if (target.type === 'Tuple' || target.type === 'List') {
    // Tuple/list unpacking: a, b = value, or a, *rest = value
    // Find starred index (if any) — only one allowed
    let starredIdx = -1;
    for (let i = 0; i < target.elts.length; i++) {
      if (target.elts[i].type === 'Starred') {
        if (starredIdx !== -1) throw new AirLowerError('multiple starred targets');
        starredIdx = i;
      }
    }
    // value's items as an array, count-checked (_py.unpack; awaited where the source may be async)
    const iterArr = emitPyIter(ctx, value, l, undefined, 'unpack', [
      ctx.emit('const', [target.elts.length], I32, l), ctx.emit('const', [starredIdx !== -1], BOOL, l)]);

    if (starredIdx === -1) {
      // Simple: index each
      for (let i = 0; i < target.elts.length; i++) {
        const idx = ctx.emit('const', [i], I32, l);
        const item = emitPyCall(ctx, 'getitem', [iterArr, idx], l);
        lowerAssignTarget(ctx, target.elts[i], item, l);
      }
    } else {
      // Before starred: index 0..starredIdx
      for (let i = 0; i < starredIdx; i++) {
        const idx = ctx.emit('const', [i], I32, l);
        const item = emitPyCall(ctx, 'getitem', [iterArr, idx], l);
        lowerAssignTarget(ctx, target.elts[i], item, l);
      }
      // Starred: slice [starredIdx : len - (n - starredIdx - 1)]
      const afterCount = target.elts.length - starredIdx - 1;
      const startConst = ctx.emit('const', [starredIdx], I32, l);
      const endExpr = afterCount === 0
        ? ctx.emit('const', [null], VOID, l)  // no end → slice to end
        : ctx.emit('const', [-afterCount], I32, l);
      const stepNull = ctx.emit('const', [null], VOID, l);
      const restArr = emitPyCall(ctx, 'slice', [iterArr, startConst, endExpr, stepNull], l);
      lowerAssignTarget(ctx, target.elts[starredIdx].value, restArr, l);
      // After starred: index from end
      for (let i = starredIdx + 1; i < target.elts.length; i++) {
        // negative index: (len - (target.elts.length - i))
        const relIdx = -(target.elts.length - i);
        const idx = ctx.emit('const', [relIdx], I32, l);
        const item = emitPyCall(ctx, 'getitem', [iterArr, idx], l);
        lowerAssignTarget(ctx, target.elts[i], item, l);
      }
    }
    return;
  }
  if (target.type === 'Starred') {
    // Bare starred in assignment — just unwrap to its value
    return lowerAssignTarget(ctx, target.value, value, l);
  }
  if (target.type === 'Attribute') {
    const obj = lowerExpr_ad(ctx, target.value);
    const name = ctx.emit('const', [target.attr], STRING, l);
    emitPyCall(ctx, 'setattr', [obj, name, value], l, VOID);
    return;
  }
  if (target.type === 'Subscript') {
    const obj = lowerExpr_ad(ctx, target.value);
    if (target.slice.type === 'Slice') {
      const lower = target.slice.lower ? lowerExpr_ad(ctx, target.slice.lower) : ctx.emit('const', [null], VOID, l);
      const upper = target.slice.upper ? lowerExpr_ad(ctx, target.slice.upper) : ctx.emit('const', [null], VOID, l);
      const step = target.slice.step ? lowerExpr_ad(ctx, target.slice.step) : ctx.emit('const', [null], VOID, l);
      emitPyCall(ctx, 'setslice', [obj, lower, upper, step, value], l, VOID);
      return;
    }
    if (target.slice.type === 'Tuple') {
      const elts = target.slice.elts.map(elt => _lowerSliceElt(ctx, elt, l));
      const arr = ctx.emit('array_new', elts.map(e => e.id), DYNAMIC, l);
      const tupleKey = emitPyCall(ctx, 'tuple', [arr], l);
      emitPyCall(ctx, 'setitem', [obj, tupleKey, value], l, VOID);
      return;
    }
    const key = lowerExpr_ad(ctx, target.slice);
    emitPyCall(ctx, 'setitem', [obj, key, value], l, VOID);
    return;
  }
  throw new AirLowerError(`unsupported assign target: ${target.type}`);
}

// Compound-assign helpers (used by lowerAugAssign). `+=` routes to `iadd`
// which dispatches __iadd__ and handles list-extend in-place; other
// compound ops route to their plain binary helpers — Python's __isub__,
// __imul__, etc. are rare on user types and the immutable-rebind behavior
// is the right default. Add entries here as real cases come up.
const IBINOP_HELPER = {
  '+': 'iadd',
};
// the other in-place operators: CPython's __iop__ / builtin-mutable semantics, synchronously (a
// method through its sync twin) — so a function with `x -= 1` stays a known-sync function
const SYNC_IOP_HELPER = {
  '-': 'isub', '*': 'imul', '/': 'itruediv', '//': 'ifloordiv', '%': 'imod', '**': 'ipow',
  '&': 'iand', '|': 'ior', '^': 'ixor', '<<': 'ilshift', '>>': 'irshift', '@': 'imatmul',
};

function lowerAugAssign(ctx, node) {
  // x op= y → x = _py.iop(x, y) for ops with in-place semantics (just `+`
  // for now); falls through to the binary helper for ops without a custom
  // in-place variant. The surrounding assignment to `x` is always emitted
  // because Python's `+=` rebinds the name even when __iadd__ mutates in
  // place (the dunder typically returns self).
  const l = ctx.loc(node);
  // Load current value
  let current;
  if (node.target.type === 'Name') {
    current = ctx.emit('load', [node.target.id], DYNAMIC, l);
  } else if (node.target.type === 'Attribute') {
    const obj = lowerExpr_ad(ctx, node.target.value);
    const name = ctx.emit('const', [node.target.attr], STRING, l);
    current = emitPyCall(ctx, 'getattr', [obj, name], l);
  } else if (node.target.type === 'Subscript') {
    const obj = lowerExpr_ad(ctx, node.target.value);
    if (node.target.slice.type === 'Slice') {
      const lower = node.target.slice.lower ? lowerExpr_ad(ctx, node.target.slice.lower) : ctx.emit('const', [null], VOID, l);
      const upper = node.target.slice.upper ? lowerExpr_ad(ctx, node.target.slice.upper) : ctx.emit('const', [null], VOID, l);
      const step = node.target.slice.step ? lowerExpr_ad(ctx, node.target.slice.step) : ctx.emit('const', [null], VOID, l);
      current = emitPyCall(ctx, 'slice', [obj, lower, upper, step], l);
    } else {
      const key = lowerExpr_ad(ctx, node.target.slice);
      current = emitPyCall(ctx, 'getitem', [obj, key], l);
    }
  } else {
    throw new AirLowerError(`unsupported augassign target: ${node.target.type}`);
  }

  const rhs = lowerExpr_ad(ctx, node.value);
  const op = node.op;
  let result;
  {
    const inPlace = IBINOP_HELPER[op];
    const helper = inPlace || SYNC_IOP_HELPER[op] || BINOP_HELPER[op];
    if (!helper) throw new AirLowerError(`unsupported augassign op: ${op}`);
    const call = emitPyCall(ctx, helper, [current, rhs], l);
    // In-place helpers (`_py.iadd`) dispatch to `__iadd__`, which can be an async adder-class
    // method returning a Promise: the assigned value must be the resolved instance. But only
    // that case awaits — numbers, strings and lists take no microtask per `+=` (an unconditional
    // await cost an accumulator loop half its time):
    //   __t = _py.iadd(x, y); if (_py.isThen(__t)) __t = await __t; x = __t
    if (inPlace) {
      const tmp = ctx.makeTempName('iop');
      ctx.emit('store', [tmp, call.id], VOID, l);
      const isThen = emitPyCall(ctx, 'isThen', [ctx.emit('load', [tmp], DYNAMIC, l)], l, BOOL);
      const thenBody = captureOps(ctx, () => {
        const awaited = ctx.emit('await', [ctx.emit('load', [tmp], DYNAMIC, l).id], DYNAMIC, l);
        ctx.emit('store', [tmp, awaited.id], VOID, l);
      });
      ctx.emit('if_region', [isThen.id], VOID, l, { then_body: thenBody, else_body: [], phis: [] });
      result = ctx.emit('load', [tmp], DYNAMIC, l);
    } else result = call;
  }

  lowerAssignTarget(ctx, node.target, result, l);
  return null;
}

function lowerAnnAssign(ctx, node) {
  // Annotated assignment: `x: int = 5`. Resolve the annotation; if it's
  // a recognisable AIR type, stamp it onto the SSA value so passes propagate
  // (e.g. `_py.add` → raw `+` when both sides are typed numbers).
  if (!node.value) return null;
  const l = ctx.loc(node);
  const value = lowerExpr_ad(ctx, node.value);
  const ann = resolveAdderAnnotation(node.annotation);
  if (!isDynamic(ann)) value.type = ann;
  lowerAssignTarget(ctx, node.target, value, l);
  return null;
}

// match subject: case p [if guard]: body ...
//   __subj = subject; __matched = false;
//   if (!__matched) { __m = await _py.match(__subj, "<descriptor>", [values], [names]);
//                     if (__m) { name1 = __m[1]; ...; if (guard) { __matched = true; body } } }
//   ... one such block per case
// A flag, not an else-chain: a failed guard falls through to the next case without duplicating
// it, and break / continue in a body still reach the enclosing loop.
function lowerMatch(ctx, node) {
  const l = ctx.loc(node);
  const subj = lowerExpr_ad(ctx, node.subject);
  const subjName = ctx.makeTempName('subj');
  ctx.emit('store', [subjName, subj.id], VOID, l);
  ctx.symbols.set(subjName, subj.id);
  const flag = ctx.makeTempName('matched');
  emitRaw(ctx, `let ${flag} = false;`, flag);
  for (const c of node.cases) {
    const cl = ctx.loc(c);
    const body = captureOps(ctx, () => {
      const valueNodes = [];
      const desc = compileMatchPattern(c.pattern, valueNodes);
      const names = matchPatternNames(c.pattern);
      const vals = ctx.emit('array_new', valueNodes.map((v) => lowerExpr_ad(ctx, v).id), DYNAMIC, cl);
      const nameArr = ctx.emit('array_new', names.map((n) => ctx.emit('const', [n], STRING, cl).id), DYNAMIC, cl);
      const call = emitPyCall(ctx, 'match', [ctx.emit('load', [subjName], DYNAMIC, cl), ctx.emit('const', [JSON.stringify(desc)], STRING, cl), vals, nameArr], cl);
      const res = ctx.emit('await', [call.id], DYNAMIC, cl);
      const resName = ctx.makeTempName('m');
      ctx.emit('store', [resName, res.id], VOID, cl);
      ctx.symbols.set(resName, res.id);
      const hit = emitPyCall(ctx, 'truthy', [ctx.emit('load', [resName], DYNAMIC, cl)], cl, BOOL);
      const thenBody = captureOps(ctx, () => {
        names.forEach((n, i) => {
          const v = emitPyCall(ctx, 'getitem', [ctx.emit('load', [resName], DYNAMIC, cl), ctx.emit('const', [i + 1], I32, cl)], cl);
          lowerAssignTarget(ctx, { type: 'Name', id: n, line: c.line, col: c.col }, v, cl);
        });
        const run = () => { emitRaw(ctx, `${flag} = true;`); for (const s of c.body) lowerStmt_ad(ctx, s); };
        if (c.guard) {
          const g = emitPyCall(ctx, 'truthy', [lowerExpr_ad(ctx, c.guard)], cl, BOOL);
          const guarded = captureOps(ctx, run);
          ctx.emit('if_region', [g.id], VOID, cl, { then_body: guarded, else_body: [], phis: [] });
        } else run();
      });
      ctx.emit('if_region', [hit.id], VOID, cl, { then_body: thenBody, else_body: [], phis: [] });
    });
    const notYet = ctx.emit('logical_not', [ctx.emit('load', [flag], BOOL, l).id], BOOL, l);
    ctx.emit('if_region', [notYet.id], VOID, l, { then_body: body, else_body: [], phis: [] });
  }
  return null;
}

function lowerTry_ad(ctx, node) {
  // try: body [except [Type] [as name]: handler] [else: orelse] [finally: finalbody]
  //
  //   try {                                  ← only when there is a finally
  //     let __noexc = false;                 ← only when there is an else
  //     try { body; __noexc = true; }
  //     catch (__exc) { BudgetExceeded passes; handler ladder; else re-throw }
  //     if (__noexc) { else }                ← outside the handlers, as in Python
  //   } finally { finalbody }
  const l = ctx.loc(node);
  const hasHandlers = !!(node.handlers && node.handlers.length);
  const hasElse = !!(node.orelse && node.orelse.length) && hasHandlers;
  const flag = hasElse ? ctx.makeTempName('noexc') : null;

  const inner = captureOps(ctx, () => {
    if (flag) emitRaw(ctx, `let ${flag} = false;`, flag);
    const tryBody = captureOps(ctx, () => {
      for (const st of node.body) lowerStmt_ad(ctx, st);
      if (flag) emitRaw(ctx, `${flag} = true;`);
      if (!hasHandlers && node.orelse && node.orelse.length) for (const st of node.orelse) lowerStmt_ad(ctx, st);
    });

    let catchParam = null;
    let catchBody = [];
    if (hasHandlers) {
      catchParam = '__exc';
      const bindName = (h) => {
        if (!h.name) return;
        const v = emitPyCall(ctx, 'excValue', [ctx.emit('load', [catchParam], DYNAMIC, l)], l);
        ctx.emit('store', [h.name, v.id], VOID, l);
        ctx.symbols.set(h.name, v.id);
      };
      // the handler runs with its exception on the shared stack (sys.exc_info(), logging.exception)
      const handlerBody = (h) => {
        const saved = ctx._excName;
        ctx._excName = catchParam;
        try {
          emitRaw(ctx, `_py.excPush(${catchParam});`);
          const body = captureOps(ctx, () => { for (const st of h.body) lowerStmt_ad(ctx, st); });
          const fin = captureOps(ctx, () => emitRaw(ctx, '_py.excPop();'));
          ctx.emit('try_region', [], VOID, l, { try_body: body, catch_param: null, catch_body: [], finally_body: fin });
        } finally { ctx._excName = saved; }
      };
      const buildHandler = (idx) => {
        if (idx >= node.handlers.length) {
          ctx.emit('throw', [ctx.emit('load', [catchParam], DYNAMIC, l).id], VOID, l);
          return;
        }
        const h = node.handlers[idx];
        if (!h.excType) { bindName(h); handlerBody(h); return; }
        const excType = lowerExpr_ad(ctx, h.excType);
        const cond = emitPyCall(ctx, 'matchException', [ctx.emit('load', [catchParam], DYNAMIC, l), excType], l, BOOL);
        const thenBody = captureOps(ctx, () => { bindName(h); handlerBody(h); });
        const elseBody = captureOps(ctx, () => buildHandler(idx + 1));
        ctx.emit('if_region', [cond.id], VOID, l, { then_body: thenBody, else_body: elseBody, phis: [] });
      };
      catchBody = captureOps(ctx, () => {
        // the run budget is not an exception a program may catch
        emitRaw(ctx, `if (${catchParam} && ${catchParam}.pyType === 'BudgetExceeded') throw ${catchParam};`);
        buildHandler(0);
      });
    }
    if (hasHandlers) {
      ctx.emit('try_region', [], VOID, l, {
        try_body: tryBody, catch_param: catchParam, catch_body: catchBody, finally_body: [],
      });
    } else {
      for (const op of tryBody) ctx.ops.push(op);   // try/finally: the finally wraps it below
    }
    if (flag) {
      const cond = ctx.emit('load', [flag], BOOL, l);
      const elseBody = captureOps(ctx, () => { for (const st of node.orelse) lowerStmt_ad(ctx, st); });
      ctx.emit('if_region', [cond.id], VOID, l, { then_body: elseBody, else_body: [], phis: [] });
    }
  });

  if (!(node.finalbody && node.finalbody.length)) {
    for (const op of inner) ctx.ops.push(op);
    return null;
  }
  const finallyBody = captureOps(ctx, () => { for (const st of node.finalbody) lowerStmt_ad(ctx, st); });
  return ctx.emit('try_region', [], VOID, l, {
    try_body: inner, catch_param: null, catch_body: [], finally_body: finallyBody,
  });
}

function lowerWith(ctx, node) {
  // `with mgr as x: body` lowers to CPython's PEP 343 expansion:
  //     __mgr = mgr
  //     __enter = _py.enterWith(__mgr)        # the bound __enter__, once __exit__ is known too
  //     __ok = True
  //     try:
  //         x = await __enter()
  //         body
  //     except BaseException as __e:
  //         __ok = False
  //         if not (await _py.exitWith(__mgr, __e)): raise
  //     finally:
  //         if __ok: await _py.exitWith(__mgr, None)
  // The normal exit is in the finally so return / break / continue out of the body run it too
  // (they're JS's own here, not exceptions), and outside the except so an exit that raises isn't
  // called again. `with a, b:` is `with a: with b:` — an exception the inner one suppressed is gone
  // for the outer. `async with` calls __aenter__ / __aexit__.
  const l = ctx.loc(node);
  const isAsync = ctx.emit('const', [!!node.isAsync], BOOL, l);

  const lowerOne = (idx) => {
    if (idx >= node.items.length) {
      for (const s of node.body) lowerStmt_ad(ctx, s);
      return;
    }
    const item = node.items[idx];

    const mgr = lowerExpr_ad(ctx, item.contextExpr);
    const mgrName = ctx.makeTempName('with_mgr');
    ctx.emit('store', [mgrName, mgr.id], VOID, l);
    ctx.symbols.set(mgrName, mgr.id);
    const enterFn = emitPyCall(ctx, 'enterWith', [ctx.emit('load', [mgrName], DYNAMIC, l), isAsync], l);
    // (the value is stored here, before the try, so the call can't be inlined into it)
    const entered = emitAwaitedCall_ad(ctx, enterFn.id, [], l);
    const valName = ctx.makeTempName('with_val');
    ctx.emit('store', [valName, entered.id], VOID, l);
    ctx.symbols.set(valName, entered.id);
    const okName = ctx.makeTempName('with_ok');
    const t = ctx.emit('const', [true], BOOL, l);
    ctx.emit('store', [okName, t.id], VOID, l);
    ctx.symbols.set(okName, t.id);

    const tryBody = captureOps(ctx, () => {
      if (item.optionalVar) lowerAssignTarget(ctx, item.optionalVar, ctx.emit('load', [valName], DYNAMIC, l), l);
      lowerOne(idx + 1);
    });

    const catchParam = ctx.makeTempName('with_exc');
    const catchBody = captureOps(ctx, () => {
      const f = ctx.emit('const', [false], BOOL, l);
      ctx.emit('store', [okName, f.id], VOID, l);
      const exitCall = emitPyCall(ctx, 'exitWith', [ctx.emit('load', [mgrName], DYNAMIC, l), ctx.emit('load', [catchParam], DYNAMIC, l), isAsync], l);
      const suppress = ctx.emit('await', [exitCall.id], DYNAMIC, l);
      const truthy = emitPyCall(ctx, 'truthy', [suppress], l, BOOL);
      const negated = ctx.emit('logical_not', [truthy.id], BOOL, l);
      const raiseBody = captureOps(ctx, () => {
        emitPyCall(ctx, 'raise', [ctx.emit('load', [catchParam], DYNAMIC, l)], l, VOID);
      });
      ctx.emit('if_region', [negated.id], VOID, l, { then_body: raiseBody, else_body: [] });
    });

    const finallyBody = captureOps(ctx, () => {
      const ok = ctx.emit('load', [okName], BOOL, l);
      const exitBody = captureOps(ctx, () => {
        const noneVal = ctx.emit('const', [null], VOID, l);
        const exitCall = emitPyCall(ctx, 'exitWith', [ctx.emit('load', [mgrName], DYNAMIC, l), noneVal, isAsync], l);
        ctx.emit('await', [exitCall.id], DYNAMIC, l);
      });
      ctx.emit('if_region', [ok.id], VOID, l, { then_body: exitBody, else_body: [] });
    });

    ctx.emit('try_region', [], VOID, l, {
      try_body: tryBody,
      catch_param: catchParam,
      catch_body: catchBody,
      finally_body: finallyBody,
    });
  };

  lowerOne(0);
  return null;
}

// what the Name `__class__` is here: the class cell it reads (a temp's name), or null when it's an
// ordinary name — bound by this function or class body, declared global, or with no class around
function _classCellRef(ctx) {
  if (ctx._classBodyOf) return ctx._classNames && ctx._classNames.has('__class__') ? null : ctx._classCell || null;
  if (!ctx._classCell) return null;
  if (ctx._fnGlobals && ctx._fnGlobals.has('__class__')) return null;
  if (ctx._fnLocalNames && ctx._fnLocalNames.includes('__class__')) return null;
  return ctx._classCell;
}

function lowerClassDef(ctx, node) {
  // Lower class via a _py.createClass runtime helper that mirrors the tree-walker.
  const l = ctx.loc(node);
  const name = node.name;

  // Evaluate bases (`*bases` spread, as in a list display) and the class keywords
  // (metaclass=, and the rest for __init_subclass__)
  const basesArr = lowerListOrTuple(ctx, { type: 'List', elts: node.bases || [], line: node.line, col: node.col });
  const kwPairs = (node.keywords || []).map((k) => (k.arg === null
    ? { spread: true, id: lowerExpr_ad(ctx, k.value).id }
    : { key: k.arg, id: lowerExpr_ad(ctx, k.value).id }));
  const kwObj = kwPairs.length ? ctx.emit('object_new', kwPairs, DYNAMIC, l) : ctx.emit('const', [null], VOID, l);

  // its methods' `__class__` (zero-argument super() reads it): a cell, made here when a method
  // names it, handed to the class factory in the namespace (__classcell__) for type.__new__ to fill
  let cellName = null;
  if (classNeedsCell(node)) {
    cellName = ctx.makeTempName('ccell');
    const c = emitPyCall(ctx, 'newCell', [], l);
    ctx.emit('store', [cellName, c.id], VOID, l);
    ctx.symbols.set(cellName, c.id);
  }
  const savedBodyCell = ctx._bodyCell;
  ctx._bodyCell = cellName;

  // Lower class body as a function that receives an empty object and populates it.
  // The class body is a sequence of statements (method defs, assignments, etc.)
  // that assign to names. We collect them into an object we return.
  const savedTopLevel = ctx.topLevel;
  ctx.topLevel = false;
  ctx.symbols = ctx.symbols.push();
  const savedClass = ctx._classBodyOf;
  ctx._classBodyOf = name;
  // the names the class body binds (assignments, defs, nested classes): mangled in the body
  const savedClassNames = ctx._classNames;
  const classNames = new Set();
  collectDefines_ad(node.body, classNames);
  (function defs(stmts) {
    for (const st of stmts || []) {
      if (!st) continue;
      if (st.type === 'FunctionDef' || st.type === 'AsyncFunctionDef' || st.type === 'ClassDef') { classNames.add(st.name); continue; }
      for (const k of ['body', 'orelse', 'finalbody']) if (Array.isArray(st[k])) defs(st[k]);
      if (Array.isArray(st.handlers)) for (const h of st.handlers) defs(h.body);
    }
  })(node.body);
  ctx._classNames = classNames;

  const body = captureOps(ctx, () => {
    // Run class body — method defs become locals, assignments become locals
    try { for (const stmt of node.body) lowerStmt_ad(ctx, stmt); } finally { ctx._classBodyOf = savedClass; ctx._classNames = savedClassNames; ctx._bodyCell = savedBodyCell; }

    // Build the class members dict from the locals
    // We need to track which names were defined in the class body.
    // Use a synthetic approach: collect names via post-analysis of the ops.
    // the members: the body's bindings (mangled `__cb_<name>`), keyed by their names
    const classMemberNames = [];
    const binding = (n) => (n.startsWith('__cb_') ? n : classNames.has(n) ? `__cb_${n}` : n);
    // the lowerer's temporaries (`__rep_42`) are not members; dunders (`__match_args__`,
    // `__slots__`, `__hash__ = None`) are
    const isTemp = (n) => n.startsWith('__') && !n.endsWith('__') && !n.startsWith('__cb_');
    // every store in the body, in order — inside if / for / while / try / with blocks too (a name
    // bound in a branch that didn't run is unbound: undefined, which createClass leaves out). Not
    // into a function's own body: its names are its own.
    const scan = (ops) => {
      for (const op of ops) {
        let n = null;
        if (op.op === 'store' && typeof op.args[0] === 'string' && !isTemp(op.args[0])) n = binding(op.args[0]);
        else if (op.op === 'func_region' && op.name) n = binding(pyNameOf(op.name));
        if (n !== null && !classMemberNames.includes(n)) classMemberNames.push(n);
        if (op.op === 'func_region') continue;
        for (const v of Object.values(op)) {
          if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && typeof v[0].op === 'string') scan(v);
        }
      }
    };
    scan(ctx.ops);
    // Append object literal containing all member names
    const pairs = classMemberNames.map(n => ({
      key: pyNameOf(n.startsWith('__cb_') ? n.slice(5) : n),
      id: ctx.emit('load', [n], DYNAMIC, l).id,
    }));
    if (cellName) pairs.push({ key: '__classcell__', id: ctx.emit('load', [cellName], DYNAMIC, l).id });
    const membersObj = ctx.emit('object_new', pairs, DYNAMIC, l);
    ctx.emit('return', [membersObj.id], VOID, l);
  });

  ctx.topLevel = savedTopLevel;
  ctx.symbols = ctx.symbols.pop();

  // Wrap body in a function: async () => { ...body; return {...} }
  const bodyFn = ctx.emit('func_region', [null], DYNAMIC, l, {
    name: null, params: [], body, ret_type: DYNAMIC,
    is_async: true, is_generator: false,
  });

  // decorators, bottom-up
  const decorators = (node.decorators || []).map(d => lowerExpr_ad(ctx, d));

  // Call class body to get members
  const membersCall = ctx.emit('call', [bodyFn.id], DYNAMIC, l);
  const membersAwaited = ctx.emit('await', [membersCall.id], DYNAMIC, l);

  // _py.createClass(name, bases, members)
  const nameConst = ctx.emit('const', [name], STRING, l);
  // the body's annotations (name, source text), flattened, for __annotations__ / dataclasses
  const annIds = [];
  for (const [k, t] of classAnnotations(node.body)) annIds.push(ctx.emit('const', [k], STRING, l).id, ctx.emit('const', [t], STRING, l).id);
  const annArr = ctx.emit('array_new', annIds, DYNAMIC, l);
  // createClass may return a promise (a base's __init_subclass__ written in Python)
  // the defining module's __name__ (a module's own; the main program's '__main__')
  const modName = ctx.moduleMirror && ctx.imports.has('__adder_module__')
    ? emitPyCall(ctx, 'moduleName', [ctx.emit('load', ['__adder_module__'], DYNAMIC, l)], l)
    : ctx.emit('const', ['__main__'], STRING, l);
  let classOp = ctx.emit('await', [emitPyCall(ctx, 'createClass', [nameConst, basesArr, membersAwaited, annArr, kwObj, modName], l).id], DYNAMIC, l);

  // Apply decorators bottom-up
  for (let i = decorators.length - 1; i >= 0; i--) {
    const d = decorators[i];
    const call = ctx.emit('call', [emitPyCall(ctx, 'fnOf', [d], l).id, classOp.id], DYNAMIC, l);
    classOp = ctx.emit('await', [call.id], DYNAMIC, l);
  }

  ctx.emit('store', [name, classOp.id], VOID, l);
  ctx.symbols.set(name, classOp.id);
  if (savedTopLevel) ctx.defines.add(name);
  return null;
}

function lowerImport(ctx, node) {
  const l = ctx.loc(node);
  // import a, b as c, d.e as f, "./utils.py" as u
  for (const { module, alias, path } of node.names) {
    let mod;
    let bindName;
    if (path) {
      // Path import: `import "./utils.py" as u`. Alias always present (required by parser).
      const pathConst = ctx.emit('const', [path], STRING, l);
      const call = emitPyCall(ctx, 'importPath', [pathConst], l);
      mod = ctx.emit('await', [call.id], DYNAMIC, l);
      bindName = alias;
    } else {
      const nameConst = ctx.emit('const', [module], STRING, l);
      // _py.import is async (it may need to async-load a module from VFS), so
      // the emitted call must be awaited. Unlike the sync `_py.*` helpers
      // (add, sub, truthy, ...), the result is a Promise, not the module.
      const call = emitPyCall(ctx, 'import', [nameConst], l);
      mod = ctx.emit('await', [call.id], DYNAMIC, l);
      // For dotted names like `a.b`, bind the top-level `a` (with `b` reachable on it) unless aliased.
      bindName = alias || module.split('.')[0];
      if (!alias && module.includes('.')) {
        const rootCall = emitPyCall(ctx, 'importRoot', [ctx.emit('const', [module], STRING, l), mod], l);
        mod = ctx.emit('await', [rootCall.id], DYNAMIC, l);
      }
    }
    ctx.emit('store', [bindName, mod.id], VOID, l);
    ctx.symbols.set(bindName, mod.id);
    if (ctx.topLevel) ctx.defines.add(bindName);
  }
  return null;
}

// CPython's rule for a relative module name (the same as eval.js resolveRelativeImport)
function _resolveRelative(module, pkg) {
  const m = /^(\.+)(.*)$/.exec(module);
  if (!pkg) throw new AirLowerError('relative import with no known parent package');
  const parts = pkg.split('.');
  const up = m[1].length - 1;
  if (up >= parts.length) throw new AirLowerError('relative import beyond top-level package');
  const base = parts.slice(0, parts.length - up).join('.');
  return m[2] ? `${base}.${m[2]}` : base;
}

function lowerImportFrom(ctx, node) {
  const l = ctx.loc(node);
  // `from m import *` binds names known only at run time: at a module's top level, onto the module
  // object, which the module then reads its names through (see lowerAdder); elsewhere (a class
  // body, a nested block) the tree-walker's
  const star = node.names.some((n) => n.name === '*');
  if (star && !(ctx.topLevel && ctx.usesGlobals && !ctx._classBodyOf)) throw new AirLowerError('from … import * needs the tree-walker');
  // Build names array: [{name, alias}, ...]
  const pairs = node.names.map(({ name, alias }) => {
    const p = [];
    p.push({ key: 'name', id: ctx.emit('const', [name], STRING, l).id });
    if (alias) p.push({ key: 'alias', id: ctx.emit('const', [alias], STRING, l).id });
    else p.push({ key: 'alias', id: ctx.emit('const', [null], VOID, l).id });
    return ctx.emit('object_new', p, DYNAMIC, l);
  });
  const namesArr = ctx.emit('array_new', pairs.map(p => p.id), DYNAMIC, l);
  // Path form: `from "./utils.py" import foo` → _py.importFromPath(path, names).
  // Logical form: `from os import path` → _py.importFrom(module, names).
  let importCall;
  if (node.path) {
    const pathConst = ctx.emit('const', [node.path], STRING, l);
    importCall = emitPyCall(ctx, 'importFromPath', [pathConst, namesArr], l);
  } else {
    // `from .x import y` in a module: against its package, known now (a cell has none, and the
    // runtime raises as CPython does at top level)
    let modName = node.module;
    if (/^\./.test(modName) && ctx.modulePackage !== undefined) modName = _resolveRelative(modName, ctx.modulePackage);
    const moduleName = ctx.emit('const', [modName], STRING, l);
    importCall = emitPyCall(ctx, 'importFrom', [moduleName, namesArr], l);
  }
  const result = ctx.emit('await', [importCall.id], DYNAMIC, l);
  if (star) emitPyCall(ctx, 'starInto', [ctx.emit('load', ['__adder_module__'], DYNAMIC, l), result], l, VOID);
  // Destructure result into scope: for each name, bind (alias || name) to result[name]
  for (const { name, alias } of node.names) {
    if (name === '*') continue; // wildcard — would need runtime enumeration
    const bindName = alias || name;
    const keyConst = ctx.emit('const', [bindName], STRING, l);
    const val = emitPyCall(ctx, 'getitem', [result, keyConst], l);
    ctx.emit('store', [bindName, val.id], VOID, l);
    ctx.symbols.set(bindName, val.id);
    if (ctx.topLevel) ctx.defines.add(bindName);
  }
  return null;
}

function lowerDelete(ctx, node) {
  const l = ctx.loc(node);
  for (const target of node.targets) {
    // `nonlocal __class__; del __class__` empties the class's cell
    if (target.type === 'Name' && target.id === '__class__' && !ctx._classBodyOf && _classCellRef(ctx)) {
      emitPyCall(ctx, 'cellSet', [ctx.emit('load', [_classCellRef(ctx)], DYNAMIC, l), ctx.emit('const', [undefined], VOID, l)], l);
      continue;
    }
    if (target.type === 'Name') {
      // Intentional limitation: `del <bare-name>` sets the binding to undefined
      // rather than truly unbinding it (transpiled JS has no `delete localVar`,
      // and a subsequent read would NameError in CPython but reads undefined
      // here). The common cases — `del dict[k]`, slices, attributes — ARE exact
      // (delitem/delslice/delattr below). Bare-name del is rare; the tree-walker
      // fallback covers code that genuinely depends on the unbind.
      const undef = ctx.emit('const', [undefined], VOID, l);
      ctx.emit('store', [target.id, undef.id], VOID, l);
      ctx.symbols.set(target.id, undef.id);
      // a module-level name: gone from the module object too (globals(), mod.name)
      if ((ctx.moduleMirror || ctx.usesGlobals) && (ctx.topLevel || (ctx._fnGlobals && ctx._fnGlobals.has(target.id)))) {
        emitRaw(ctx, `delete __adder_module__[${JSON.stringify(target.id)}];`);
      }
    } else if (target.type === 'Subscript') {
      const obj = lowerExpr_ad(ctx, target.value);
      if (target.slice.type === 'Slice') {
        const lower = target.slice.lower ? lowerExpr_ad(ctx, target.slice.lower) : ctx.emit('const', [null], VOID, l);
        const upper = target.slice.upper ? lowerExpr_ad(ctx, target.slice.upper) : ctx.emit('const', [null], VOID, l);
        const step = target.slice.step ? lowerExpr_ad(ctx, target.slice.step) : ctx.emit('const', [null], VOID, l);
        emitPyCall(ctx, 'delslice', [obj, lower, upper, step], l, VOID);
      } else {
        const key = lowerExpr_ad(ctx, target.slice);
        emitPyCall(ctx, 'delitem', [obj, key], l, VOID);
      }
    } else if (target.type === 'Attribute') {
      const obj = lowerExpr_ad(ctx, target.value);
      const name = ctx.emit('const', [target.attr], STRING, l);
      emitPyCall(ctx, 'delattr', [obj, name], l, VOID);
    } else {
      throw new AirLowerError(`unsupported del target: ${target.type}`);
    }
  }
  return null;
}

// ── Control flow ──

function lowerIf_ad(ctx, node) {
  return lowerIfRegion(ctx,
    () => lowerExpr_ad(ctx, node.test),
    () => { for (const s of node.body) lowerStmt_ad(ctx, s); },
    () => { if (node.orelse) for (const s of node.orelse) lowerStmt_ad(ctx, s); },
    ctx.loc(node));
}

function lowerFor_ad(ctx, node) {
  // for target in iter: body (target may be Name or Tuple/List)
  const l = ctx.loc(node);
  if (node.orelse && node.orelse.length) {
    // for/else desugar via _lowerLoopWithElse, mirroring while/else.
    return _lowerLoopWithElse(ctx, node, l, () => _lowerForLoopBody(ctx, node, l));
  }
  // Any loop is a fresh `break` target — null the outer breakHook for the
  // body so a `break` inside this loop only ends THIS loop, not the outer
  // loop with an else clause.
  return _withClearedBreakHook(ctx, () => _lowerForLoopBody(ctx, node, l));
}

function _withClearedBreakHook(ctx, fn) {
  const prev = ctx.breakHook;
  ctx.breakHook = null;
  try { return fn(); } finally { ctx.breakHook = prev; }
}

// `for i in range(...)` as a counted loop: no range object or array is built (range(10**8) used
// to allocate the whole list first), and the loop variable is typed as an integer.
//   __rng = _py.rangeArgs([args])    // [start, stop, step, sign(step)], validated once (ints, step != 0)
//   for (__k = start; (__k - stop) * sign < 0; __k += step) { i = __k; body }
// The counter is separate from `i`, so assigning to `i` in the body doesn't change the
// iteration, and after the loop `i` keeps its last value (untouched when the range is empty).
function _isPlainRangeCall(ctx, n) {
  return n && n.type === 'Call' && n.func.type === 'Name' && n.func.id === 'range' && !ctx.symbols.has('range') &&
    !(n.keywords && n.keywords.length) && n.args.length >= 1 && n.args.length <= 3 && !n.args.some((a) => a.type === 'Starred');
}
// The counted loop over `range(...)` (rangeCall: the Call node), shared by `for` statements and
// comprehension clauses. `prepare()` runs once the arguments are evaluated (before the loop);
// `bindTarget(curId)` binds the loop variable from the counter's value at the top of each
// iteration; `lowerBody()` lowers the rest of the body.
function _emitCountedRange(ctx, rangeCall, l, { prepare, bindTarget, lowerBody }) {
  const argOps = rangeCall.args.map((a) => lowerExpr_ad(ctx, a));
  const rng = emitPyCall(ctx, 'rangeArgs', [ctx.emit('array_new', argOps.map((o) => o.id), DYNAMIC, l)], l);
  const rngName = ctx.makeTempName('rng');
  ctx.emit('store', [rngName, rng.id], VOID, l);
  const part = (i) => {
    const v = emitPyCall(ctx, 'getitem', [ctx.emit('load', [rngName], DYNAMIC, l), ctx.emit('const', [i], I32, l)], l);
    const name = ctx.makeTempName(['k', 'stop', 'step', 'dir'][i]);
    ctx.emit('store', [name, v.id], I32, l);   // declared integer: rangeArgs validated it
    return name;
  };
  const K = part(0), STOP = part(1), STEP = part(2);
  // a literal positive step (or none) needs no direction test
  const stepArg = rangeCall.args[2];
  const ascending = !stepArg || (stepArg.type === 'Constant' && typeof stepArg.value === 'number' && stepArg.value > 0);
  const DIR = ascending ? null : part(3);
  if (prepare) prepare();

  let test = null;
  const testOps = captureOps(ctx, () => {
    const k = ctx.emit('load', [K], DYNAMIC, l), stop = ctx.emit('load', [STOP], DYNAMIC, l);
    if (ascending) test = ctx.emit('lt', [k.id, stop.id], BOOL, l);
    else {
      const diff = ctx.emit('sub', [k.id, stop.id], DYNAMIC, l);
      const signed = ctx.emit('mul', [diff.id, ctx.emit('load', [DIR], DYNAMIC, l).id], DYNAMIC, l);
      test = ctx.emit('lt', [signed.id, ctx.emit('const', [0], I32, l).id], BOOL, l);
    }
  });
  const updateOps = captureOps(ctx, () => {
    const next = ctx.emit('add', [ctx.emit('load', [K], DYNAMIC, l).id, ctx.emit('load', [STEP], DYNAMIC, l).id], DYNAMIC, l);
    ctx.emit('store', [K, next.id], VOID, l);
  });
  const bodyOps = captureOps(ctx, () => {
    // the loop variable: an integer (as the `_py.iter(range(...))` typing gave it)
    bindTarget(ctx.emit('load', [K], I32, l).id);
    lowerBody();
  });
  return ctx.emit('for_region', [], VOID, l, {
    init: [], test: testOps, test_val: test.id, update: updateOps, body: bodyOps, phis: [],
  });
}

function _lowerRangeLoop(ctx, node, l) {
  const loopVar = node.target.id;
  return _emitCountedRange(ctx, node.iter, l, {
    prepare: () => _preDeclareTargetNames(ctx, node.target, l),   // only if unbound: an empty loop leaves an existing value
    bindTarget: (cur) => { ctx.emit('store', [loopVar, cur], VOID, l); ctx.symbols.set(loopVar, cur); },
    lowerBody: () => { for (const st of node.body) lowerStmt_ad(ctx, st); },
  });
}

function _lowerForLoopBody(ctx, node, l) {
  if (node.isAsync) return _lowerAsyncFor(ctx, node, l);
  if (node.target.type === 'Name' && _isPlainRangeCall(ctx, node.iter)) return _lowerRangeLoop(ctx, node, l);
  const iter = lowerExpr_ad(ctx, node.iter);
  // Where the code is async anyway (cell level, a top-level function that isn't sync), the loop
  // is hybrid (emitForOfHybrid): lists by index, sync iterators by next(), async sources awaited
  // item by item — lazily. Elsewhere, and for range() (which passes type as i32), a plain for-of.
  const isRange = node.iter.type === 'Call' && node.iter.func.type === 'Name' && node.iter.func.id === 'range' && !ctx.symbols.has('range');
  const hybrid = !!ctx._loopMayAwait && !isRange;
  const iterArr = hybrid ? emitPyCall(ctx, 'iterLazy', [iter], l) : emitPyIter(ctx, iter, l);
  // `for x in gen():` — nothing else holds the iterator, so (as CPython's reference counting does)
  // the loop finalizes it when it exits early: a break, a return, an exception (release_temp)
  const ownsIter = node.iter.type === 'Call' && !isRange;

  // Simple case: target is an Identifier
  if (node.target.type === 'Name') {
    const loopVar = node.target.id;
    _preDeclareTargetNames(ctx, node.target, l);   // only if unbound: an empty loop leaves an existing value

    const body = captureOps(ctx, () => {
      for (const s of node.body) lowerStmt_ad(ctx, s);
    });
    return ctx.emit('for_of_region', [iterArr.id], VOID, l, {
      body, phis: [], target_name: loopVar, hybrid, indexed: !hybrid, release_temp: ownsIter,
    });
  }

  // Tuple/List target: use a synthetic temp variable, unpack in body
  if (node.target.type === 'Tuple' || node.target.type === 'List') {
    const tempName = ctx.makeTempName('forv');
    // Pre-declare each target element at module scope if top-level
    _preDeclareTargetNames(ctx, node.target, l);

    const body = captureOps(ctx, () => {
      // Unpack temp into target
      const tempLoad = ctx.emit('load', [tempName], DYNAMIC, l);
      for (let i = 0; i < node.target.elts.length; i++) {
        const elt = node.target.elts[i];
        const idx = ctx.emit('const', [i], I32, l);
        const item = emitPyCall(ctx, 'getitem', [tempLoad, idx], l);
        lowerAssignTarget(ctx, elt, item, l);
      }
      for (const s of node.body) lowerStmt_ad(ctx, s);
    });
    return ctx.emit('for_of_region', [iterArr.id], VOID, l, {
      body, phis: [], target_name: tempName, hybrid, indexed: !hybrid, release_temp: ownsIter,
    });
  }

  throw new AirLowerError(`unsupported for-loop target: ${node.target.type}`);
}

// `async for target in src:` — a for-await over _py.aiter(src), which reads it by __aiter__ /
// __anext__ (an async generator, a class with the protocol) until StopAsyncIteration
function _lowerAsyncFor(ctx, node, l) {
  const src = emitPyCall(ctx, 'aiter', [lowerExpr_ad(ctx, node.iter)], l);
  _preDeclareTargetNames(ctx, node.target, l);
  const simple = node.target.type === 'Name';
  const targetName = simple ? node.target.id : ctx.makeTempName('forv');
  const body = captureOps(ctx, () => {
    if (!simple) lowerAssignTarget(ctx, node.target, ctx.emit('load', [targetName], DYNAMIC, l), l);
    for (const s of node.body) lowerStmt_ad(ctx, s);
  });
  return ctx.emit('for_of_region', [src.id], VOID, l, { body, phis: [], target_name: targetName, is_await: true, indexed: false });
}

function _preDeclareTargetNames(ctx, target, l) {
  if (!target) return;
  if (target.type === 'Name') {
    if (!ctx.symbols.has(target.id)) {
      const undef = ctx.emit('const', [undefined], VOID, l);
      ctx.emit('store', [target.id, undef.id], VOID, l);
      ctx.symbols.set(target.id, undef.id);
      // a module-level name: gone from the module object too (globals(), mod.name)
      if ((ctx.moduleMirror || ctx.usesGlobals) && (ctx.topLevel || (ctx._fnGlobals && ctx._fnGlobals.has(target.id)))) {
        emitRaw(ctx, `delete __adder_module__[${JSON.stringify(target.id)}];`);
      }
      if (ctx.topLevel && !ctx._compDepth) ctx.defines.add(target.id);
    }
    return;
  }
  if (target.type === 'Tuple' || target.type === 'List') {
    for (const elt of target.elts) _preDeclareTargetNames(ctx, elt, l);
  }
  if (target.type === 'Starred') _preDeclareTargetNames(ctx, target.value, l);
}

function lowerWhile_ad(ctx, node) {
  const l = ctx.loc(node);
  const hasElse = node.orelse && node.orelse.length;
  if (!hasElse) {
    return _withClearedBreakHook(ctx, () => lowerLoopRegion(ctx,
      () => lowerExpr_ad(ctx, node.test),
      () => { for (const s of node.body) lowerStmt_ad(ctx, s); },
      l, 'while'));
  }

  // while/else desugar: `__broken = False; while test: body (with break →
  // __broken = True; break); if not __broken: orelse`. Inner loops save/
  // restore breakHook via the try/finally so a nested break doesn't fire
  // the outer loop's hook.
  return _lowerLoopWithElse(ctx, node, l, () => {
    lowerLoopRegion(ctx,
      () => lowerExpr_ad(ctx, node.test),
      () => { for (const s of node.body) lowerStmt_ad(ctx, s); },
      l, 'while');
  });
}

function _lowerLoopWithElse(ctx, node, l, lowerLoopFn) {
  const brokenName = ctx.makeTempName('broken');
  const falseVal = ctx.emit('const', [false], BOOL, l);
  ctx.emit('store', [brokenName, falseVal.id], VOID, l);

  const prevHook = ctx.breakHook;
  ctx.breakHook = (brkLoc) => {
    const trueVal = ctx.emit('const', [true], BOOL, l);
    ctx.emit('store', [brokenName, trueVal.id], VOID, brkLoc || l);
  };
  try {
    lowerLoopFn();
  } finally {
    ctx.breakHook = prevHook;
  }

  // if (not __broken) { orelse }
  const loadBroken = ctx.emit('load', [brokenName], BOOL, l);
  const notBroken = ctx.emit('logical_not', [loadBroken.id], BOOL, l);
  const orelseBody = captureOps(ctx, () => {
    for (const s of node.orelse) lowerStmt_ad(ctx, s);
  });
  ctx.emit('if_region', [notBroken.id], VOID, l, {
    then_body: orelseBody, else_body: [], phis: [],
  });
  return null;
}

// ── Functions and lambdas ──

// Detect if a function body contains yield (makes it a generator)
function _containsYield(stmts) {
  for (const s of stmts || []) {
    if (!s || typeof s !== 'object') continue;
    if (s.type === 'Yield' || s.type === 'YieldFrom') return true;
    // Don't descend into nested functions/classes/lambdas
    if (s.type === 'FunctionDef' || s.type === 'AsyncFunctionDef' ||
        s.type === 'ClassDef' || s.type === 'Lambda') continue;
    for (const key of Object.keys(s)) {
      if (key === 'type' || key === 'line' || key === 'col') continue;
      const v = s[key];
      if (Array.isArray(v)) { if (_containsYield(v)) return true; }
      else if (v && typeof v === 'object' && v.type) {
        if (_containsYield([v])) return true;
      }
    }
  }
  return false;
}

// Build a parameter list + prologue ops that binds positional/vararg/kwonly/kwarg
// Returns { jsParams, prologueOps } where jsParams is the JS function signature
// and prologueOps are ops to emit at the start of the body.
// Python: a name a function body assigns is local to that function (unless the body declares
// it global / nonlocal), even when an enclosing scope binds the same name. Without a declaration
// here, a store would find the enclosing `let` (the module hoists its names) and overwrite it:
// a helper's `ix = ...` clobbered the caller's loop variable `ix`.
function _declareFunctionLocals(ctx, node) {
  const assigned = new Set();
  collectDefines_ad(node.body, assigned);
  const keep = new Set([
    ...(node.params || []).map((p) => p.name), ...(node.kwonly || []).map((p) => p.name),
    ...(node.vararg ? [node.vararg.name || node.vararg] : []), ...(node.kwarg ? [node.kwarg.name || node.kwarg] : []),
  ]);
  const walk = (stmts) => {
    for (const s of stmts || []) {
      if (!s) continue;
      if (s.type === 'Global' || s.type === 'Nonlocal') for (const n of s.names) keep.add(n);
      if (s.type === 'FunctionDef' || s.type === 'AsyncFunctionDef' || s.type === 'ClassDef') { keep.add(s.name); continue; }
      for (const k of ['body', 'orelse', 'finalbody']) if (Array.isArray(s[k])) walk(s[k]);
      if (Array.isArray(s.handlers)) for (const h of s.handlers) walk(h.body);
      if (Array.isArray(s.cases)) for (const c of s.cases) walk(c.body);
    }
  };
  walk(node.body);
  for (const n of assigned) {
    if (keep.has(n) || typeof n !== 'string') continue;
    emitRaw(ctx, `let ${jsSafeName(n)} = undefined;`, n);
    ctx.symbols.set(n, null);
  }
}

function _buildParamBinding(ctx, node, l) {
  const positionalParams = node.params || [];
  const kwonly = node.kwonly || [];
  const vararg = node.vararg;
  const kwarg = node.kwarg;

  // JS parameters: all positional (with optional defaults inlined as JS default values
  // via a special dynamic mechanism), then one rest parameter for the remaining.
  // For simplicity we collect everything in ...callArgs and bind in the prologue.
  // Naming: use the original Python parameter names in the body.

  // For the simple fast path (no vararg, no kwarg, no kwonly, no defaults), use native
  // JS params directly. This avoids the prologue overhead for common functions.
  const hasAnyDefault = positionalParams.some(p => p.default);
  const hasKwonly = kwonly.length > 0;
  const isSimple = !vararg && !kwarg && !hasKwonly && !hasAnyDefault;

  if (isSimple) {
    // Fast path: native JS params, with handling for a trailing kwargs bag that
    // may be ignored or matched by name. Resolve param annotations so passes
    // can specialise arithmetic and helper calls inside the body.
    const params = positionalParams.map(p => ({
      name: p.name,
      type: resolveAdderAnnotation(p.annotation),
    }));
    // Prologue: a call that does not fit the native params (keywords, too few, too many)
    // goes through _py.bindArgs, which binds by name and raises Python's TypeErrors.
    // Reading `arguments` is cheap in strict-mode code; the function must not be an arrow.
    const fname = JSON.stringify(node.name || '<lambda>');
    const names = params.map(p => p.name);
    // (More arguments than params is fine: JS callers pass extras, as Array.map does.)
    const prologueOps = captureOps(ctx, () => {
      const bag = `_py.isKwBag(arguments[arguments.length - 1])`;
      if (names.length === 0) {
        emitRaw(ctx, `if (arguments.length && ${bag}) _py.bindArgs(${fname}, [], arguments);`);
      } else {
        // (a def's defaults object: a missing argument may have been given a default since)
        const defs = ctx._defsObj ? `, ${ctx._defsObj}` : '';
        emitRaw(ctx, `if (arguments.length < ${names.length} || ${bag}) [${names.map(jsSafeName).join(', ')}] = _py.bindArgs(${fname}, ${JSON.stringify(names)}, arguments${defs});`);
      }
    });
    // the params are locals of the body, as the general path below records them: without
    // this a parameter read in the body was reported as a free (imported) name
    for (const p of params) ctx.symbols.set(p.name, null);
    return { params, prologueOps, isSimple: true, needsArguments: true };
  }

  // Complex path: use ...callArgs and bind in prologue.
  // The JS function signature is `function(...__args)`, and we extract from __args.
  const params = [{ name: '...__args', type: DYNAMIC }];

  const prologueOps = captureOps(ctx, () => {
  // _kwObj = (last arg has _kw marker) ? args.pop() : null
  // const _kwObj = (__args.length > 0 && __args[__args.length-1]?._kw) ? __args.pop() : null;
  const fname = JSON.stringify(node.name || '<lambda>');
  const allNames = JSON.stringify([...positionalParams.map(p => p.name), ...kwonly.map(p => p.name)]);
  const defaults = ctx._paramDefaults || {};
  // a def reads every parameter no argument filled from its defaults object, at call time — the
  // object __defaults__ / __kwdefaults__ rewrite (a lambda keeps its evaluated defaults)
  const D = ctx._defsObj;
  // (read inline — a parameter without one reads undefined, one taken away NO_DEFAULT: the helper
  // then raises the missing-argument error)
  const missing = (p, kwonly) => `((__dv = ${D}[${JSON.stringify(p.name)}]) !== undefined && __dv !== _py.NO_DEFAULT ? __dv : _py.dflt(${D}, '${p.name}', ${fname}, ${kwonly}))`;
  emitRaw(ctx, `let __kw = null;`, '__kw');
  if (D) emitRaw(ctx, `let __dv;`, '__dv');
  emitRaw(ctx, `if (__args.length > 0 && __args[__args.length-1] && __args[__args.length-1]._kw) __kw = __args.pop();`);
  // only the positional parameters can be filled twice (a keyword-only one after *args cannot)
  emitRaw(ctx, `if (__kw) _py.checkKw(${fname}, ${allNames}, Math.min(__args.length, ${positionalParams.length}), __kw, ${kwarg ? 'true' : 'false'});`);

  // Track parameter names used (for **kwargs exclusion)
  const usedNames = [];

  // Positional parameters
  for (let i = 0; i < positionalParams.length; i++) {
    const p = positionalParams[i];
    usedNames.push(p.name);
    if (D) {
      emitRaw(ctx, `let ${jsSafeName(p.name)} = (__args.length > ${i}) ? __args[${i}] : (__kw && Object.hasOwn(__kw, '${p.name}') ? __kw['${p.name}'] : ${missing(p, false)});`, p.name);
    } else if (p.default) {
      // the default was evaluated once, at definition (lowerFuncDef / lowerLambda)
      const def = defaults[p.name] || _refExpr(ctx, lowerExpr_ad(ctx, p.default).id);
      emitRaw(ctx, `let ${jsSafeName(p.name)} = (__args.length > ${i}) ? __args[${i}] : (__kw && Object.hasOwn(__kw, '${p.name}') ? __kw['${p.name}'] : ${def});`, p.name);
    } else {
      emitRaw(ctx, `let ${jsSafeName(p.name)} = (__args.length > ${i}) ? __args[${i}] : (__kw && Object.hasOwn(__kw, '${p.name}') ? __kw['${p.name}'] : _py.argError(${fname} + "() missing 1 required positional argument: '${p.name}'"));`, p.name);
    }
    ctx.symbols.set(p.name, null);
  }

  // *args — vararg
  if (vararg) {
    emitRaw(ctx, `let ${jsSafeName(vararg)} = _py.tuple(__args.slice(${positionalParams.length}));`, vararg);
    ctx.symbols.set(vararg, null);
    // (not usedNames: a keyword argument named like *args is still a keyword — **kwargs gets it)
  }

  // Keyword-only params
  for (const p of kwonly) {
    usedNames.push(p.name);
    if (D) {
      emitRaw(ctx, `let ${jsSafeName(p.name)} = (__kw && Object.hasOwn(__kw, '${p.name}')) ? __kw['${p.name}'] : ${missing(p, true)};`, p.name);
    } else if (p.default) {
      const def = defaults[p.name] || _refExpr(ctx, lowerExpr_ad(ctx, p.default).id);
      emitRaw(ctx, `let ${jsSafeName(p.name)} = (__kw && Object.hasOwn(__kw, '${p.name}')) ? __kw['${p.name}'] : ${def};`, p.name);
    } else {
      emitRaw(ctx, `let ${jsSafeName(p.name)} = (__kw && Object.hasOwn(__kw, '${p.name}')) ? __kw['${p.name}'] : _py.argError(${fname} + "() missing 1 required keyword-only argument: '${p.name}'");`, p.name);
    }
    ctx.symbols.set(p.name, null);
  }

  // **kwargs — collect remaining
  if (kwarg) {
    const excludeList = [...usedNames, '_kw'].map(n => `'${n}'`).join(',');
    // (through _py: emitted code mustn't name a JS global a Python module may rebind — `Set` from collections.abc)
    emitRaw(ctx, `let ${jsSafeName(kwarg)} = _py.kwRest(__kw, [${excludeList}]);`, kwarg);
    ctx.symbols.set(kwarg, null);
  }
  });

  return { params, prologueOps, isSimple: false };
}

// Helper: emit a raw JS line via an 'opaque' op (statement-level)
function emitRaw(ctx, jsLine, declaredName = null) {
  const op = ctx.emit('opaque', [jsLine], VOID, null);
  if (declaredName) declaredName = jsSafeName(declaredName);
  // When the raw line declares a name (`let X = ...;`), record it on the
  // op so the emitter pushes X into the current scope chain. Without this
  // hook, downstream `store X` ops re-emit `let X = ...` and trigger a
  // temporal-dead-zone shadow (V8: "Cannot access 'X' before initialization").
  if (declaredName) op._markDeclared = declaredName;
}

// Helper: stringify SSA id into a ref that the emitter will resolve.
// Since we're building raw JS strings for prologue, we need the SSA value as a JS expression.
// Approach: emit a store to a synthetic name, then use that name in the raw line.
// Evaluate a def's / lambda's parameter defaults in the enclosing scope, each into a named
// temp the parameter binding then reads: once per definition, as Python does.
// a def's parameters as inspect describes them (names and kinds; default VALUES ride separately)
function _sigShape(node) {
  const posonly = node.posonly || 0;
  return {
    params: (node.params || []).map((p, i) => ({ name: p.name, kind: i < posonly ? 'POSITIONAL_ONLY' : 'POSITIONAL_OR_KEYWORD', hasDefault: !!p.default })),
    vararg: node.vararg ? (node.vararg.name || node.vararg) : null,
    kwonly: (node.kwonly || []).map((p) => ({ name: p.name, kind: 'KEYWORD_ONLY', hasDefault: !!p.default })),
    kwarg: node.kwarg ? (node.kwarg.name || node.kwarg) : null,
    isAsync: node.type === 'AsyncFunctionDef',
    line: node.line || 0,
  };
}

function _lowerParamDefaults(ctx, node) {
  const out = {};
  for (const p of [...(node.params || []), ...(node.kwonly || [])]) {
    if (p.default) out[p.name] = _refExpr(ctx, lowerExpr_ad(ctx, p.default).id);
  }
  return out;
}

function _refExpr(ctx, ssaId) {
  // Emit a store to a fresh name, then reference it
  const name = `__tmp_${ssaId.slice(1)}`;
  ctx.emit('store', [name, ssaId], VOID, null);
  ctx.symbols.set(name, ssaId);
  return name;
}

// Code Python only ever calls implicitly, where compiled code can't wait for a Promise: a
// property's getter / setter / deleter, a cached_property, and the dunders whose call sites AIR
// emits as plain helper calls (`a == b` is `_py.eq(a, b)`, `a[i]` `_py.getitem(a, i)`, len(),
// str(), hash(), a descriptor's __get__ …). CPython can't await there either, so these bodies
// compile in SYNC MODE: their possible awaits (a call to a function the lowerer can't prove
// sync, a guarded `+=`) become `_py.noAwait(v)` — the value as it is. Without this, one
// maybe-async call made the whole method async and every `==` / read of the property a Promise.
// (A callee that really is async — an `async def` — still hands back its Promise, as CPython's
// would a coroutine.) Not in sync mode: the dunders whose call sites DO await — construction,
// __call__, the in-place operators (guarded), `with`, iteration — and class-creation hooks.
// does the program call globals() / locals() anywhere?
// (__defaults__ / __kwdefaults__ are a compiled def's live defaults object — see lowerFuncDef)
const _FN_INTERNALS = new Set(['__code__']);
const _isFnInternal = (n) => n && n.type === 'Attribute' && _FN_INTERNALS.has(n.attr);
function _rewritesFunctionInternals(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(_rewritesFunctionInternals);
  const stores = (t) => t && (_isFnInternal(t) || (t.type === 'Subscript' && _isFnInternal(t.value)) ||
    ((t.type === 'Tuple' || t.type === 'List') && t.elts.some(stores)));
  if ((node.type === 'Assign' && node.targets.some(stores)) || ((node.type === 'AugAssign' || node.type === 'AnnAssign') && stores(node.target))) return true;
  // f.__kwdefaults__.update(...) / .pop / .setdefault / .clear
  if (node.type === 'Call' && node.func && node.func.type === 'Attribute' && _isFnInternal(node.func.value) &&
    ['update', 'pop', 'popitem', 'setdefault', 'clear', '__setitem__', '__delitem__'].includes(node.func.attr)) return true;
  for (const k in node) if (k !== 'line' && k !== 'col' && typeof node[k] === 'object' && _rewritesFunctionInternals(node[k])) return true;
  return false;
}
function _callsScopeBuiltin(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(_callsScopeBuiltin);
  if (node.type === 'Call' && node.func && node.func.type === 'Name' && (node.func.id === 'globals' || node.func.id === 'locals' || node.func.id === 'exec' || node.func.id === 'eval')) return true;
  for (const k in node) if (k !== 'line' && k !== 'col' && typeof node[k] === 'object' && _callsScopeBuiltin(node[k])) return true;
  return false;
}
// does `name`, read here, mean the module-level binding (or a builtin)? — not a function's
// own local, a parameter, or a class body's name
function _resolvesToModule(ctx, name) {
  let f = ctx.symbols;
  while (f && !f.bindings.has(name)) f = f.parent;
  return !f || f.parent === null;
}
// a function's local names (CPython's locals()): its parameters and what its body binds, less
// what it declares global / nonlocal
function _functionLocalNames(node) {
  const assigned = new Set();
  collectDefines_ad(node.body, assigned);
  const out = [...(node.params || []).map((p) => p.name), ...(node.kwonly || []).map((p) => p.name)];
  if (node.vararg) out.push(node.vararg.name || node.vararg);
  if (node.kwarg) out.push(node.kwarg.name || node.kwarg);
  const outer = new Set();
  (function walk(stmts) {
    for (const s of stmts || []) {
      if (!s) continue;
      if (s.type === 'Global' || s.type === 'Nonlocal') for (const n of s.names) outer.add(n);
      if (s.type === 'FunctionDef' || s.type === 'AsyncFunctionDef' || s.type === 'ClassDef') { assigned.add(s.name); continue; }
      for (const k of ['body', 'orelse', 'finalbody']) if (Array.isArray(s[k])) walk(s[k]);
      if (Array.isArray(s.handlers)) for (const h of s.handlers) walk(h.body);
      if (Array.isArray(s.cases)) for (const c of s.cases) walk(c.body);
    }
  })(node.body);
  for (const n of assigned) if (typeof n === 'string' && !out.includes(n)) out.push(n);
  return out.filter((n) => typeof n === 'string' && !outer.has(n));
}
// (__new__ is NOT here: it's construction plumbing — `self.__class__(…)` in a sync-mode
// __add__ must get an instance, not a Promise — and I/O in __new__ is rare; __init__ may do I/O)
const AWAITED_DUNDERS = new Set(['__init__', '__new__', '__call__', '__post_init__', '__del__',
  '__enter__', '__exit__', '__aenter__', '__aexit__', '__iter__', '__next__', '__aiter__', '__anext__', '__await__',
  '__iadd__', '__isub__', '__imul__', '__imatmul__', '__itruediv__', '__ifloordiv__', '__imod__', '__ipow__',
  '__ilshift__', '__irshift__', '__iand__', '__ixor__', '__ior__',
  '__init_subclass__', '__set_name__', '__class_getitem__', '__prepare__', '__instancecheck__', '__subclasscheck__',
  '__reduce__', '__reduce_ex__', '__getstate__', '__setstate__', '__copy__', '__deepcopy__']);
const _SYNC_DECORATORS = new Set(['property', 'cached_property', 'setter', 'getter', 'deleter']);
const _isDunder = (n) => n.length > 4 && n.startsWith('__') && n.endsWith('__');
function _syncContextName(node, inClassBody) {
  if (node.type === 'AsyncFunctionDef' || node.isAsync || node.is_async || _containsYield(node.body)) return null;
  for (const d of node.decorators || []) {
    const n = d.type === 'Name' ? d.id : d.type === 'Attribute' ? d.attr : null;
    if (n && _SYNC_DECORATORS.has(n)) return `${n === 'setter' || n === 'deleter' || n === 'getter' ? 'property ' + n : n} '${node.name}'`;
  }
  if (inClassBody && _isDunder(node.name) && !AWAITED_DUNDERS.has(node.name)) return node.name;
  return null;
}

function lowerFuncDef(ctx, node) {
  const l = ctx.loc(node);
  const name = node.name;
  const isGenerator = _containsYield(node.body);
  // sync mode: a dunder / property Python calls implicitly; or a def nested in sync-mode code (a
  // twin or such a dunder) — what code that can't wait defines and calls can't wait either
  // (jinja2's Lexer.__init__ compiles its rules through a local `def c(x): return re.compile(x)`)
  const ownSync = !!_syncContextName(node, !!ctx._classBodyOf);
  const syncMode = ownSync ||
    (!!ctx._syncMode && !!ctx._fnDepth && node.type !== 'AsyncFunctionDef' && !node.isAsync);
  // A dunder / property in sync mode is compiled the other way round from a twinned function:
  // the sync version IS the method, and gives up at a value it would have to wait for (as a twin
  // does), falling back to an async version of itself — whose Promise its caller may well
  // await (the import machinery awaits a lazy module's __getattr__). _py.bailable joins them.
  const bailable = ownSync && !isGenerator && !ctx._fnDepth && !ctx.noTwins;

  // Lower decorators (evaluated at def time, applied bottom-up after def). Each is bound to a
  // temp HERE: left as an expression it was inlined at the apply site, after the def had
  // rebound the name — so `@v.setter` read the new function instead of the property.
  const decorators = (node.decorators || []).map(d => {
    const v = lowerExpr_ad(ctx, d);
    const name = _refExpr(ctx, v.id);
    return ctx.emit('load', [name], DYNAMIC, l);
  });
  // then the defaults, once, here in the enclosing scope (Python semantics)
  const savedDefaults = ctx._paramDefaults;
  ctx._paramDefaults = _lowerParamDefaults(ctx, node);
  const defaultRefs = ctx._paramDefaults;            // their temps, for the signature below
  // ...gathered in one object: the def's calls bind a missing argument from it, and it is the one
  // __defaults__ / __kwdefaults__ rewrite (_py.defSig, builtins _setFunctionInternal) — so
  // `f.__defaults__ = (…)` after the def reaches compiled calls, as namedtuple's __new__ needs
  const defsObj = ctx.makeTempName('defs');
  emitRaw(ctx, `const ${defsObj} = {${Object.entries(defaultRefs).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(', ')}};`, defsObj);
  const savedDefsObj = ctx._defsObj;
  const savedExcName = ctx._excName;
  ctx._excName = null;
  // zero-argument super() in a method: the enclosing class and the method's first parameter
  const savedSuper = ctx._superCtx, savedClassBody = ctx._classBodyOf, savedCell = ctx._classCell;
  // the `__class__` cell it sees: its class's, for a method; a nested function's enclosing one's
  const fnCell = ctx._classBodyOf ? ctx._bodyCell || null : ctx._classCell || null;
  const superCtx = (node.params || []).length ? { cell: fnCell, self: node.params[0].name } : node.vararg ? { varargSelf: true } : { noArgs: true };
  // A SYNC TWIN: a function AIR can't prove synchronous is compiled async — it awaits whatever
  // it calls. Code Python calls implicitly (a property, __len__, __eq__, a hash) can't wait, so
  // such a function is also compiled in sync mode as `fn._pySync`, and sync-mode code calls the
  // twins (see emitPyCall's _SYNC_CALLS, _py.syncOf / fnOfSync / callMethodSync). Module
  // functions and methods get one, and so does a def directly inside one — a factory's product:
  // dataclasses' __create_fn__ returns the __init__ / __setattr__ it builds, a decorator returns
  // its wrapper — but not deeper nestings: each level would double the code again (a depth-1 def
  // is lowered three times: twinned in its parent's async pass, sync in the parent's twin).
  // `async def` never does. A generator's twin is a synchronous generator: an async one (its body
  // awaits) can't be read by a loop that can't wait.
  const twinned = !syncMode && node.type !== 'AsyncFunctionDef' && !node.isAsync &&
    !ctx.syncFunctions.has(name) && (!ctx._fnDepth || (ctx._fnDepth === 1 && !ctx._syncMode)) && !ctx.noTwins;

  // Lower the body in a nested scope — once as the function; once more, in sync mode, as its twin.
  const lowerBody = (mode, twinPass = false) => {
    const savedTwinMode = ctx._twinMode;
    ctx._twinMode = twinPass || (!!ctx._twinMode && !!mode);
    ctx._superCtx = superCtx;
    ctx._classCell = fnCell;
    ctx._classBodyOf = null;
    const savedTopLevel = ctx.topLevel;
    ctx.topLevel = false;
    ctx._fnDepth = (ctx._fnDepth || 0) + 1;
    ctx.symbols = ctx.symbols.push();
    const savedSyncMode = ctx._syncMode;
    ctx._syncMode = mode;
    const savedFnLocals = ctx._fnLocalNames;
    ctx._fnLocalNames = _functionLocalNames(node);
    const savedRename = ctx._compRename;
    ctx._compRename = _unshadowed(savedRename, ctx._fnLocalNames);
    // its `for` loops may await (hybrid) only if the function is async anyway: top-level, not a
    // method, not a generator, not one analyseSyncFunctions proved sync
    const savedLoopAwait = ctx._loopMayAwait;
    // (a generator or method too: the source may be an async generator — most compiled functions
    // that call methods are async — and a plain for-of can't wait for it; not in sync mode)
    ctx._loopMayAwait = !ctx.syncFunctions.has(node.name) && !mode;
    const savedFnGlobals = ctx._fnGlobals;
    ctx._fnGlobals = new Set();   // the names this function declares `global` (module mirror)
    ctx._paramDefaults = defaultRefs;
    ctx._defsObj = defsObj;
    ctx._excName = null;

    const out = { params: null, isSimple: null, needsArgs: false, body: null };
    out.body = captureOps(ctx, () => {
      // Build parameter binding (prologue + JS params)
      const r = _buildParamBinding(ctx, node, l);
      ctx._defsObj = savedDefsObj;   // (not the body's own defs and lambdas)
      out.params = r.params; out.isSimple = r.isSimple; out.needsArgs = !!r.needsArguments;

      // Emit prologue ops
      for (const op of r.prologueOps) ctx.ops.push(op);
      _declareFunctionLocals(ctx, node);

      // Docstring skip (first string expression)
      let startIdx = 0;
      if (node.body.length > 0 && node.body[0].type === 'Expr' &&
          node.body[0].value.type === 'Constant' &&
          typeof node.body[0].value.value === 'string') {
        startIdx = 1;
      }
      for (let i = startIdx; i < node.body.length; i++) lowerStmt_ad(ctx, node.body[i]);
    });

    ctx.topLevel = savedTopLevel;
    ctx._fnDepth -= 1;
    ctx._syncMode = savedSyncMode;
    ctx._fnLocalNames = savedFnLocals;
    ctx._compRename = savedRename;
    ctx._loopMayAwait = savedLoopAwait;
    ctx._fnGlobals = savedFnGlobals;
    ctx.symbols = ctx.symbols.pop();
    ctx._paramDefaults = savedDefaults;
    ctx._excName = savedExcName;
    ctx._superCtx = savedSuper;
    ctx._classCell = savedCell;
    ctx._classBodyOf = savedClassBody;
    ctx._twinMode = savedTwinMode;
    return out;
  };
  const dep0 = ctx._modeDependent;
  const main = lowerBody(syncMode, bailable);
  const params = main.params, body = main.body, needsArgs = main.needsArgs;
  // a body that awaits nothing, calls no helper with a sync form and defines nothing (a def, a
  // lambda, a class: lowered differently in sync mode) is the same code in either mode: then the
  // function is its own sync version — no twin, no async fallback to bail to. (Generators keep
  // theirs: a twin is a different kind of generator.)
  const sameInBothModes = ctx._modeDependent === dep0 && !isGenerator;

  // Return type from `-> Type` annotation, if present.
  const retType = node.returns ? resolveAdderAnnotation(node.returns) : DYNAMIC;

  // Carry the function's signature as the op's own type so name-typing at
  // call sites can read off ret_type. Mirrors what the JS lowerer does.
  const fType = func(params.map(p => p.type || DYNAMIC), retType);

  // Sync if analyseSyncFunctions flagged this name AND it's not a generator.
  // The body's lowering above already used ctx.syncFunctions to skip awaits
  // at sync callsites, so the body has zero await ops in the sync case.
  const isSync = !isGenerator && ctx.syncFunctions.has(name);

  const op = ctx.emit('func_region', [name], fType, l, {
    name, params, body, ret_type: retType,
    // Never forced async: emit-js's emitFunc promotes to async iff the emitted body
    // actually awaits (the same _bodyHasAwait path generators use). analyseSyncFunctions
    // still decides the call sites — a function it can't prove sync is awaited by its
    // callers, which is right whether it ends up async or not. What it can't see is an
    // await the passes removed: `s += i` on numbers loses its guarded await once the types
    // are known, and a function whose only async-looking statement was that is plain.
    // A sync function thus emits a plain `function`, usable as a synchronous JS callback.
    is_async: false,
    is_generator: isGenerator,
    needs_arguments: needsArgs,
    in_class: !!ctx._classBodyOf,   // a method: never the module's function of the same name (emit-js)
  });

  // Always emit a store so the function name is visible in the enclosing scope.
  // (At module scope, this becomes `let name = funcExpr` via the emitter.
  //  At function scope, nested defs also need to be stored so sibling code can see them.)
  ctx.emit('store', [name, op.id], VOID, l);
  ctx.symbols.set(name, op.id);
  let finalId = op.id;
  const doc = node.body.length > 0 && node.body[0].type === 'Expr' && node.body[0].value.type === 'Constant' &&
    typeof node.body[0].value.value === 'string' ? node.body[0].value.value : null;
  // (in a class body the function is bound as `__cb_<name>` — see lowerClassDef)
  const refName = ctx._classBodyOf && ctx._classNames && ctx._classNames.has(name) ? `__cb_${name}` : jsSafeName(name);
  // its generator objects show the function's name (`<generator object g at ...>`)
  if (isGenerator) emitRaw(ctx, `_py.genProto(${refName}, ${JSON.stringify(name)}${node.type === 'AsyncFunctionDef' ? ', true' : ''});`);
  if (bailable && !sameInBothModes) {
    const asy = lowerBody(null);
    const asyOp = ctx.emit('func_region', [null], fType, l, {
      name: null, params: asy.params, body: asy.body, ret_type: retType,
      is_async: false, is_generator: false, needs_arguments: asy.needsArgs, in_class: false,
    });
    const asyTmp = ctx.makeTempName('async');
    ctx.emit('store', [asyTmp, asyOp.id], VOID, l);
    emitRaw(ctx, `${refName} = _py.bailable(${refName}, ${asyTmp});`);
  }
  if (doc !== null) emitRaw(ctx, `${refName}.__doc__ = ${JSON.stringify(doc)};`);
  // a Python function: its signature as written, its defaults as evaluated (inspect, __defaults__)
  emitRaw(ctx, `_py.defSig(${refName}, ${JSON.stringify(_sigShape(node))}, ${defsObj}${ctx.moduleMirror ? ', __adder_module__' : ''});`);
  if (twinned && !sameInBothModes) {
    const tw = lowerBody(`${name} (sync twin)`, true);
    // anonymous: the twin is reached only through fn._pySync (a module-level `function name`
    // declaration would collide with the function itself)
    const twinOp = ctx.emit('func_region', [null], fType, l, {
      name: null, params: tw.params, body: tw.body, ret_type: retType,
      is_async: false, is_generator: isGenerator, needs_arguments: tw.needsArgs, in_class: false,
    });
    const twinTmp = ctx.makeTempName('twin');
    ctx.emit('store', [twinTmp, twinOp.id], VOID, l);
    if (isGenerator) emitRaw(ctx, `_py.genProto(${twinTmp}, ${JSON.stringify(name)});`);
    emitRaw(ctx, `Object.defineProperty(${refName}, '_pySync', { value: ${twinTmp}, configurable: true, writable: true });`);
  }

  // Apply decorators bottom-up: name = decorator(name)
  for (let i = decorators.length - 1; i >= 0; i--) {
    const dec = decorators[i];
    const loadFn = ctx.emit('load', [name], DYNAMIC, l);
    // a decorator may be any callable — an instance with __call__ (networkx's argmap) too
    const callee = emitPyCall(ctx, 'fnOf', [dec], l);
    const call = ctx.emit('call', [callee.id, loadFn.id], DYNAMIC, l);
    const awaited = ctx.emit('await', [call.id], DYNAMIC, l);
    ctx.emit('store', [name, awaited.id], VOID, l);
    ctx.symbols.set(name, awaited.id);
    finalId = awaited.id;
  }

  if (ctx.topLevel) {
    ctx.defines.add(name);
    ctx.symbols.set(name, finalId);
  }

  return op;
}

function lowerLambda(ctx, node) {
  const l = ctx.loc(node);
  // defaults: once, here in the enclosing scope (so `lambda i=i:` captures each i)
  const savedDefaults = ctx._paramDefaults;
  ctx._paramDefaults = _lowerParamDefaults(ctx, node);
  const defaultRefs = ctx._paramDefaults;
  // ...in one object its calls bind from, which __defaults__ rewrites — as a def's (lowerFuncDef):
  // namedtuple builds __new__ as an eval'd lambda, then assigns its __defaults__
  const defsObj = ctx.makeTempName('defs');
  emitRaw(ctx, `const ${defsObj} = {${Object.entries(defaultRefs).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(', ')}};`, defsObj);
  // lowered as the lambda; and, like a def (lowerFuncDef), once more in sync mode as its twin —
  // a lambda that calls anything compiles async, and code that can't wait calls it (`c =
  // lambda x: re.compile(x)` in a jinja2 __init__ reached from a property). Not for a lambda in
  // a lambda (each level would double).
  const lowerLamBody = (mode, twinPass = false) => {
    const savedTwinMode = ctx._twinMode;
    ctx._twinMode = twinPass || (!!ctx._twinMode && !!mode);
    const savedTopLevel = ctx.topLevel;
    ctx.topLevel = false;
    ctx.symbols = ctx.symbols.push();
    ctx._lamDepth = (ctx._lamDepth || 0) + 1;
    const out = { params: null, needsArgs: false, body: null };
    const savedSyncMode = ctx._syncMode;
    ctx._syncMode = mode;
    const savedFnLocals = ctx._fnLocalNames;
    ctx._fnLocalNames = (node.params || []).map((p) => p.name);
    const savedRename = ctx._compRename;
    ctx._compRename = _unshadowed(savedRename, [...ctx._fnLocalNames, ...(node.kwonly || []).map((p) => p.name), node.vararg && (node.vararg.name || node.vararg), node.kwarg && (node.kwarg.name || node.kwarg)]);
    ctx._paramDefaults = defaultRefs;
    out.body = captureOps(ctx, () => {
      // Reuse the function param binding logic
      const savedDefsObj = ctx._defsObj;
      ctx._defsObj = defsObj;
      const r = _buildParamBinding(ctx, node, l);
      ctx._defsObj = savedDefsObj;
      out.params = r.params; out.needsArgs = !!r.needsArguments;
      for (const op of r.prologueOps) ctx.ops.push(op);

      const val = lowerExpr_ad(ctx, node.body);
      ctx.emit('return', [val.id], VOID, l);
    });

    ctx.topLevel = savedTopLevel;
    ctx._lamDepth -= 1;
    ctx._syncMode = savedSyncMode;
    ctx._fnLocalNames = savedFnLocals;
    ctx._compRename = savedRename;
    ctx.symbols = ctx.symbols.pop();
    ctx._paramDefaults = savedDefaults;
    ctx._twinMode = savedTwinMode;
    return out;
  };
  // `lambda: (yield)` is a generator function (its expression is the generator's return value)
  const isGen = _containsYield([{ type: 'Expr', value: node.body }]);
  // in sync-mode code a lambda is sync mode itself (no twin needed)
  const inSync = ctx._syncMode;
  const twinned = !inSync && !ctx._lamDepth && !ctx.noTwins && !isGen;
  const main = lowerLamBody(inSync || null);

  // marked a Python function (_py.lam): a lambda in a class body is a method, a builtin isn't
  // Lambdas are never async-defs (Python has no `async lambda`). emit-js's emitFunc promotes to
  // async iff the body actually awaits (_bodyHasAwait), so a sync lambda — the common
  // map/filter/sort/Series.apply callback — emits a plain `function`, callable synchronously by
  // JS consumers.
  const mkLam = (b) => ctx.emit('func_region', [null], DYNAMIC, l, {
    name: null, params: b.params, body: b.body, ret_type: DYNAMIC, needs_arguments: b.needsArgs,
    is_async: false, is_generator: isGen,
  });
  const lam = mkLam(main);
  const made = isGen ? emitPyCall(ctx, 'lam', [emitPyCall(ctx, 'genLambda', [lam], l)], l)
    : !twinned ? emitPyCall(ctx, 'lam', [lam], l)
    : emitPyCall(ctx, 'lam', [lam, mkLam(lowerLamBody('lambda (sync twin)', true))], l);
  // its signature and live defaults (inspect, __defaults__), as a def's (not its __globals__: a
  // lambda made in a loop would pay for it each time)
  const ref = _refExpr(ctx, made.id);
  emitRaw(ctx, `_py.defSig(${ref}, ${JSON.stringify(_sigShape(node))}, ${defsObj});`);
  return ctx.emit('load', [ref], DYNAMIC, l);
}

// ── List comprehension ──
// [expr for target in iter if cond ...] → loop + array.push

function lowerListOrTuple(ctx, node) {
  const l = ctx.loc(node);
  // If no starred elements, use array_new directly
  const hasStarred = node.elts.some(e => e.type === 'Starred');
  if (!hasStarred) {
    const elts = node.elts.map(e => lowerExpr_ad(ctx, e).id);
    return ctx.emit('array_new', elts, DYNAMIC, l);
  }
  // With starred elements: build via _py.buildList which flattens starred iterables
  const parts = node.elts.map(e => {
    if (e.type === 'Starred') {
      const inner = lowerExpr_ad(ctx, e.value);
      return { spread: true, id: inner.id };
    }
    return { spread: false, id: lowerExpr_ad(ctx, e).id };
  });
  // Emit object with spread markers — use object_new with mixed spread/plain
  // Actually, easier: use _py.buildList with an array of {spread, value} pairs.
  // Simplest JS: emit an array literal with ...spread directly.
  const argIds = [];
  for (const p of parts) {
    if (p.spread) {
      argIds.push(ctx.emit('spread', [p.id], DYNAMIC, l).id);
    } else {
      argIds.push(p.id);
    }
  }
  return ctx.emit('array_new', argIds, DYNAMIC, l);
}

function lowerComprehension(ctx, node) {
  const l = ctx.loc(node);
  const kind = node.type; // 'ListComp' | 'SetComp' | 'DictComp' | 'GeneratorExp'
  if (kind === 'GeneratorExp') return lowerGeneratorExp(ctx, node);

  // Result storage depends on kind
  let tempName, initOp;
  if (kind === 'ListComp') {
    initOp = ctx.emit('array_new', [], DYNAMIC, l);
    tempName = ctx.makeTempName('comp');
  } else if (kind === 'SetComp') {
    const arr = ctx.emit('array_new', [], DYNAMIC, l);
    initOp = emitPyCall(ctx, 'makeSet', [arr], l);
    tempName = ctx.makeTempName('setc');
  } else {
    // DictComp — use a Map
    const empty1 = ctx.emit('array_new', [], DYNAMIC, l);
    const empty2 = ctx.emit('array_new', [], DYNAMIC, l);
    initOp = emitPyCall(ctx, 'makeDict', [empty1, empty2], l);
    tempName = ctx.makeTempName('dictc');
  }
  ctx.emit('store', [tempName, initOp.id], VOID, l);
  ctx.symbols.set(tempName, initOp.id);

  // innermost: append / add / set into the result
  const innermost = () => {
    const loadResult = ctx.emit('load', [tempName], DYNAMIC, l);
    if (kind === 'ListComp') {
      const val = lowerExpr_ad(ctx, node.elt);
      ctx.emit('call_method', [loadResult.id, 'push', val.id], VOID, l);
    } else if (kind === 'SetComp') {
      const val = lowerExpr_ad(ctx, node.elt);
      ctx.emit('call_method', [loadResult.id, 'add', val.id], VOID, l);
    } else {
      const key = lowerExpr_ad(ctx, node.key);
      const val = lowerExpr_ad(ctx, node.value);
      ctx.emit('call_method', [loadResult.id, 'set', key.id, val.id], VOID, l);
    }
  };

  // comprehension variables are the comprehension's own (Python 3): not module defines,
  // which would put a loop-scoped `let` into the module's returned names
  ctx._compDepth = (ctx._compDepth || 0) + 1;
  try {
    _lowerCompLoops(ctx, node, 0, {
      iterOf: (gen) => emitPyIter(ctx, lowerExpr_ad(ctx, gen.iter), l),
      countedRange: () => true,
      innermost, isAwait: false,
    });
  } finally { ctx._compDepth--; }

  return ctx.emit('load', [tempName], DYNAMIC, l);
}

// The loops of a comprehension: one for_of_region per `for` clause, its filters as nested ifs,
// `opts.innermost` at the bottom. The loop variables are fresh bindings of each loop (a
// comprehension's own scope, as in Python 3), never the enclosing function's or module's
// variables of the same name.
function _lowerCompLoops(ctx, node, genIdx, opts) {
  const l = ctx.loc(node);
  if (genIdx >= node.generators.length) { opts.innermost(); return; }
  const gen = node.generators[genIdx];
  const asyncClause = !!gen.isAsync;   // `async for` in a comprehension: read by __aiter__ / __anext__
  // Its variables are the comprehension's own (Python 3) and ONE binding each for the whole loop,
  // as in CPython — a closure made in it sees the last value (`[lambda: i for i in r]`), not the
  // value of its iteration, which a JS `for (let …)` would give. So each is a temp declared here,
  // once, and the Python name maps to it while the comprehension's inner part is lowered.
  const names = new Set();
  collectTargetNames(gen.target, names);
  const savedRename = ctx._compRename;
  const rename = new Map(savedRename || []);
  for (const n of names) {
    const t = ctx.makeTempName('cv');
    emitRaw(ctx, `let ${t};`, t);
    ctx.symbols.set(t, null);
    rename.set(n, t);
  }
  try {
    _lowerCompClause(ctx, node, genIdx, opts, gen, asyncClause, rename);
  } finally { ctx._compRename = savedRename; }
}
function _lowerCompClause(ctx, node, genIdx, opts, gen, asyncClause, rename) {
  const l = ctx.loc(node);

  // this clause's filters as nested ifs, then the next clause (or the innermost body)
  const withFilters = (filterIdx) => {
    if (!gen.ifs || filterIdx >= gen.ifs.length) { _lowerCompLoops(ctx, node, genIdx + 1, opts); return; }
    const cond = lowerExpr_ad(ctx, gen.ifs[filterIdx]);
    const truthy = emitPyCall(ctx, 'truthy', [cond], l, BOOL);
    const thenBody = captureOps(ctx, () => withFilters(filterIdx + 1));
    ctx.emit('if_region', [truthy.id], VOID, l, { then_body: thenBody, else_body: [], phis: [] });
  };

  // `for k in range(...)` — a counted loop, as for statements (no range object stepped through an
  // iterator). The variable is declared afresh in the body: the comprehension's own, like the
  // for-of target below. Not for a clause whose source was already evaluated (a generator
  // expression's first, which Python evaluates eagerly, outside).
  if (!asyncClause && gen.target.type === 'Name' && opts.countedRange && opts.countedRange(genIdx) && _isPlainRangeCall(ctx, gen.iter)) {
    const name = gen.target.id;
    _emitCountedRange(ctx, gen.iter, l, {
      bindTarget: (cur) => {
        ctx._compRename = rename;
        ctx.symbols.set(name, null);
        ctx.emit('store', [name, cur], VOID, l);
      },
      lowerBody: () => withFilters(0),
    });
    return;
  }

  const iterArr = asyncClause ? emitPyCall(ctx, 'aiter', [lowerExpr_ad(ctx, gen.iter)], l) : opts.iterOf(gen, genIdx);
  // (the source is the enclosing scope's — or the outer clauses' — the variables from here on)
  ctx._compRename = rename;
  let targetName, fresh = false;
  const body = captureOps(ctx, () => {
    if (gen.target.type === 'Name') {
      targetName = rename.get(gen.target.id);
      ctx.symbols.set(gen.target.id, null);
    } else if (gen.target.type === 'Tuple' || gen.target.type === 'List') {
      targetName = ctx.makeTempName('gen');
      fresh = true;
      const names = new Set();
      collectTargetNames(gen.target, names);
      for (const n of names) ctx.symbols.set(n, null);
      const tempLoad = ctx.emit('load', [targetName], DYNAMIC, l);
      for (let i = 0; i < gen.target.elts.length; i++) {
        const elt = gen.target.elts[i];
        const idx = ctx.emit('const', [i], I32, l);
        const item = emitPyCall(ctx, 'getitem', [tempLoad, idx], l);
        lowerAssignTarget(ctx, elt, item, l);
      }
    } else {
      throw new AirLowerError('unsupported comprehension target type');
    }
    withFilters(0);
  });

  ctx.emit('for_of_region', [iterArr.id], VOID, l, {
    body, phis: [], target_name: targetName, fresh_target: fresh, is_await: !!opts.isAwait || asyncClause, indexed: !opts.isAwait && !asyncClause,
  });
}

// does an op list await anywhere (not counting nested functions, which await for themselves)?
function _opsAwait(ops) {
  for (const op of ops || []) {
    if (op.op === 'await' || (op.op === 'for_of_region' && op.is_await)) return true;
    if (op.op === 'func_region' || op.op === 'class_region') continue;
    for (const k of Object.keys(op)) {
      const v = op[k];
      if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && typeof v[0].op === 'string' && _opsAwait(v)) return true;
    }
  }
  return false;
}

// A generator expression is lazy, as in Python: it lowers to a generator function that yields
// each element, called on its outermost iterable (evaluated now, as CPython does). Two
// variants, chosen at run time by _py.genExpr:
//   sync  — function*: a plain for-of over a synchronous source, when the expression has one
//           `for` clause and its body awaits nothing. The common, fast case.
//   async — async function*: for await at every level, for an async source (a tree-walked
//           generator, itertools, map) or a body that awaits.
function lowerGeneratorExp(ctx, node) {
  const l = ctx.loc(node);
  // (an async generator expression — `async for` in it — is the tree-walker's)
  if (node.generators.some((g) => g.isAsync)) throw new AirLowerError('an async generator expression needs the tree-walker');
  const src = lowerExpr_ad(ctx, node.generators[0].iter);
  const SRC = '__gsrc';
  const build = (isAwait) => {
    const savedTop = ctx.topLevel;
    ctx.topLevel = false;
    ctx.symbols = ctx.symbols.push();
    ctx.symbols.set(SRC, null);
    ctx._compDepth = (ctx._compDepth || 0) + 1;
    try {
      return captureOps(ctx, () => _lowerCompLoops(ctx, node, 0, {
        iterOf: (gen, idx) => (idx === 0 ? ctx.emit('load', [SRC], DYNAMIC, l)
          : isAwait ? emitPyCall(ctx, 'each', [lowerExpr_ad(ctx, gen.iter)], l)
            : emitPyIter(ctx, lowerExpr_ad(ctx, gen.iter), l)),
        countedRange: (idx) => idx > 0,   // the first source is evaluated outside, eagerly (Python)
        innermost: () => { ctx.emit('yield', [lowerExpr_ad(ctx, node.elt).id], DYNAMIC, l); },
        isAwait,
      }));
    } finally {
      ctx._compDepth--;
      ctx.symbols = ctx.symbols.pop();
      ctx.topLevel = savedTop;
    }
  };
  const genFn = (body, isAsync) => ctx.emit('func_region', [null], DYNAMIC, l, {
    name: null, params: [{ name: SRC, type: DYNAMIC }], body, ret_type: DYNAMIC, is_async: isAsync, is_generator: true,
  });
  let syncFn;
  // (with nested sources, only in code that can't wait: there an inner source that turns out to
  // be async bails out, where elsewhere the sync body would iterate a Promise)
  if (node.generators.length === 1 || ctx._syncMode) {
    const syncBody = build(false);
    syncFn = _opsAwait(syncBody) ? null : genFn(syncBody, false);
  }
  const asyncFn = genFn(build(true), true);
  const call = emitPyCall(ctx, 'genExpr', [src, syncFn || ctx.emit('const', [null], VOID, l), asyncFn], l);
  call._mayBeAsyncIter = true;   // a `for` over it may need to await (emitPyIter)
  return call;
}
