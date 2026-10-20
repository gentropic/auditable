// @gcu/adder — high-level runtime API (tree-walker path).
// Companion: @gcu/adder/air exports the same API backed by AIR transpilation
// (15-300x faster), at the cost of requiring @gcu/air as a peer dep.

import { adderParse, _adderParseExpr } from './parse.js';
import { adderEval, AdderScope, _setRunOptions, _setBudget, _makeBudget, registerModule, unregisterModule, setModuleCompiler } from './eval.js';
import { adderBuiltins, setAdderVFS, getAdderVFS, _stdio, adderModules, frozenPyModules, frozenPyCompiled, frozenPyBuild } from './builtins.js';
import { _py } from './runtime.js';
import { lowerAdder, PY_SPECIALIZATIONS, pyNameOf } from './air-lower.js';

// Strip common leading whitespace. Python has no meaningful indentation at the
// module level, so a natural template literal like `\n    def foo(): ...` can
// be safely normalized — and it has to be, otherwise adder's indentation-
// sensitive parser rejects it. Ignores completely-blank lines when computing
// the common indent.
function _dedent(code) {
  if (typeof code !== 'string' || code.indexOf('\n') === -1) return code;
  const lines = code.split('\n');
  let min = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^[ \t]*/);
    const n = m ? m[0].length : 0;
    if (n < min) min = n;
    if (min === 0) break;
  }
  if (!Number.isFinite(min) || min === 0) return code;
  return lines.map(l => l.slice(min)).join('\n');
}

// ── IO defaults ──

const _defaultStdout = (s) => {
  if (typeof process !== 'undefined' && process.stdout) process.stdout.write(s);
  else if (typeof globalThis !== 'undefined' && globalThis.console) globalThis.console.log(s.replace(/\n$/, ''));
};
const _defaultStderr = (s) => {
  if (typeof process !== 'undefined' && process.stderr) process.stderr.write(s);
  else if (typeof globalThis !== 'undefined' && globalThis.console) globalThis.console.error(s.replace(/\n$/, ''));
};
const _defaultStdin = () => { throw new AdderRuntimeError('input() called but no stdin was provided'); };

class AdderRuntimeError extends Error {
  constructor(msg) { super(msg); this.name = 'AdderRuntimeError'; }
}

// ── build options into a scope + builtins set ──

// adder's print builtin formats the args (sep, end) and passes a single
// pre-formatted string to the printFn we pass in. Our default printFn just
// forwards to stdout. When the user provides `opts.print`, we REPLACE adder's
// print builtin entirely with their function — giving them access to raw
// args the way Python's print receives them.

function _makePrintFn(opts) {
  const stdout = opts.stdout || _defaultStdout;
  return (s) => stdout(s);
}

function _makeInput(opts) {
  if (opts.input) return opts.input;
  const stdin = opts.stdin || _defaultStdin;
  const stdout = opts.stdout || _defaultStdout;
  return async (prompt) => {
    if (prompt != null) stdout(String(prompt));
    const line = await stdin();
    if (line == null) throw new AdderRuntimeError('EOF while reading input');
    return line;
  };
}

function _makeBindings(opts) {
  const printFn = _makePrintFn(opts);
  const builtins = adderBuiltins(printFn);
  if (opts.print) builtins.print = opts.print;      // user wins; gets raw args
  builtins.input = _makeInput(opts);
  return {
    ...builtins,
    ...(opts.globals || {}),
    ...(opts.locals || {}),
  };
}

function _withVfs(opts, fn) {
  if (!opts.vfs) return fn();
  const prev = getAdderVFS();
  setAdderVFS(opts.vfs);
  try { return fn(); }
  finally { setAdderVFS(prev); }
}

// the sandbox options (host / remote / budget) are module-level state for the
// duration of ONE call, restored on exit like the VFS — so a notebook cell and
// a worker host can share the interpreter without seeing each other's rules
export async function _withSandbox(opts, fn) {
  // engine 'tree' keeps imported modules on the tree-walker too (else they are AIR-compiled)
  const prevOpts = _setRunOptions({ host: opts.host !== false, remote: opts.remote !== false, moduleEngine: opts.engine === 'tree' ? 'tree' : 'auto' });
  const prevBudget = _setBudget(_makeBudget(opts.budget));
  const prevOut = _stdio.out, prevErr = _stdio.err;
  _stdio.out = opts.stdout || _defaultStdout;
  _stdio.err = opts.stderr || _defaultStderr;
  try { return await fn(); }
  finally { _setRunOptions(prevOpts); _setBudget(prevBudget); _stdio.out = prevOut; _stdio.err = prevErr; }
}

// ── the AIR engine (opts.engine) ──
// The same run() can compile adder to JavaScript through @gcu/air instead of walking the
// tree: 10-600x faster on loops, same scope out, same sandbox (host / remote / budget —
// the budget through _py.tick before every statement). The host attaches AIR once:
//   attachAir(await import('@gcu/air'))   // or the @gcu/air bundle's namespace
// engine: 'tree' (default) | 'air' (compile or throw) | 'auto' (compile when it can, else
// tree-walk: no AIR attached, budget.onStep (a trace needs interpreter frames), a construct
// the lowerer refuses, or a free name the bindings don't supply — the tree-walker raises the
// proper NameError for that one, where compiled code would see undefined).

const _AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// JS intrinsics AIR's imports may list but which resolve via the ambient global scope
export const _JS_INTRINSICS = new Set([
  'Math', 'console', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  // (not Error / TypeError / ValueError / RangeError: in Python those names are the
  // exception types adder's builtins provide, not JS globals)
  'Date', 'RegExp',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'NaN', 'Infinity',
  'Int8Array', 'Uint8Array', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'ArrayBuffer', 'DataView', 'globalThis',
]);

let _airLib = null;
export function attachAir(air) {
  const a = air && air.default && !air.runPasses ? air.default : air;
  if (!a || typeof a.runPasses !== 'function' || typeof a.emitJS !== 'function' || typeof a.needsAsync !== 'function') {
    throw new TypeError('attachAir: expected @gcu/air (runPasses, emitJS, needsAsync)');
  }
  // adder's _py fast paths live in AIR's specialization registry: give them to this copy
  if (typeof a.registerSpecializations === 'function') a.registerSpecializations('_py', PY_SPECIALIZATIONS);
  _airLib = a;
  return a;
}
export function airAttached() { return _airLib !== null; }

// AIR-compile a parsed module. Throws on anything it cannot lower or emit.
export function _airCompile(ast, src, ticks) {
  if (!_airLib) throw new AdderRuntimeError("engine 'air' needs @gcu/air: call attachAir(air) first");
  const mod = lowerAdder(ast, src, { ticks });
  _airLib.runPasses(mod);
  const imports = [...(mod.imports || [])].filter((n) => !_JS_INTRINSICS.has(n));
  const scopeKeys = ['_py', ...imports];
  // unhinted, as the notebook cell path emits: an integer type means "integer-valued" in adder
  // (ints are unbounded doubles), so the `| 0` an i32 hint adds would wrap 2**31 and beyond
  const body = _airLib.emitJS(mod, scopeKeys, [], { hinted: false });
  const Ctor = _airLib.needsAsync(mod) ? _AsyncFunction : Function;
  return { air: mod, imports, fn: new Ctor(...scopeKeys, body) };
}

// An imported module, AIR-compiled — the same engine as the cell importing it, so the module's
// functions, properties and dunders are plain (mostly sync) JS functions there, not the
// tree-walker's async ones (a cell reading a tree-walked @property got a Promise). Returns null
// when no AIR is reachable; throws when the module can't be lowered (eval.js then tree-walks it).
// Works with AIR attached (attachAir) or through the browser hooks auditable installs.
//   src: the source; info: { package, kind: 'module' | 'exec' | 'eval', artifact? }; parse(): its
//   AST, called only when the module isn't in the compile cache (a cached module is never parsed
//   again). info.artifact: the module precompiled at build time (stdlib-pyair.js) — used as is.
// Gives { run(lookup, moduleObj), doc } — doc the module's docstring.
function _airCompileModule(src, info, parse) {
  if (!_airReachable()) return null;
  let c;
  if (info.artifact) {
    // (made into a function once, on its first import)
    c = info.artifact._made || (info.artifact._made = { imports: info.artifact.imports, doc: info.artifact.doc, fn: new Function(`return ${info.artifact.code}`)() });
    return _compiledModule(c);
  }
  const key = `${info.kind || 'module'}\0${info.package || ''}\0${src}`;
  c = _compiled.get(key);
  if (c !== undefined) { _compiled.delete(key); _compiled.set(key, c); }   // most recently used last
  else {
    let rec = _fromStore(key);
    if (!rec) {
      const ast = parse();     // a SyntaxError propagates: the caller reports it
      try {
        const m = compileModuleSource(src, info, ast);
        rec = { imports: m.imports, async: m.async, body: m.body, doc: m.doc };
        _toStore(key, rec);
      } catch (e) {
        rec = { error: e };     // remembered too: a module AIR can't lower isn't lowered again
        // (a SyntaxError found while lowering isn't stored: revived, it would be a plain Error)
        if (!(e && e.pyType)) _toStore(key, { fail: String(e && e.message) });
      }
    }
    c = rec.error ? { error: rec.error, size: src.length }
      : { imports: rec.imports, fn: new (rec.async ? _AsyncFunction : Function)('_py', ...rec.imports, rec.body), doc: rec.doc, size: src.length + rec.body.length };
    _compiled.set(key, c);
    _compiledSize += c.size;
    for (const [k, v] of _compiled) {
      if (_compiledSize <= _COMPILED_MAX || k === key) break;
      _compiled.delete(k); _compiledSize -= v.size;
    }
  }
  if (c.error) throw c.error;
  return _compiledModule(c);
}
setModuleCompiler(_airCompileModule);
// run(lookup): lookup(pythonName) gives each free name's value (builtins, module globals);
// `__adder_module__` is the live module object the bindings are mirrored onto
function _compiledModule({ imports, fn, doc }) {
  return { doc, run: (lookup, moduleObj) => fn(_py, ...imports.map((n) => (n === '__adder_module__' ? moduleObj : lookup(pyNameOf(n))))) };
}
// AIR as this host has it: attached (attachAir), or the browser hooks auditable installs
function _airHooks() {
  if (_airLib) return _airLib;
  const w = typeof window !== 'undefined' ? window : null;
  if (!w || !w._airRePropagate || !w._airEmit || !w._airNeedsAsync) return null;
  return { runPasses: (m) => w._airRePropagate(m), emitJS: w._airEmit, needsAsync: w._airNeedsAsync };
}
const _airReachable = () => _airHooks() !== null;
// Precompiled frozen modules beyond the bundled hot set — @gcu/adder/batteries (gen-pyair.js), a
// plain { build, modules } — so an import of one on AIR skips compiling it. Taken only from the
// adder build that made it (the same compiler output for every module); from any other, nothing
// is (those modules compile on import, as without it). Gives how many modules it added. Process-wide.
export function addPrecompiled(data) {
  if (!data || !data.modules || data.build !== frozenPyBuild.id) return 0;
  let n = 0;
  for (const [name, art] of Object.entries(data.modules)) {
    if (!Object.hasOwn(frozenPyModules, name) || Object.hasOwn(frozenPyCompiled, name)) continue;
    frozenPyCompiled[name] = art; n++;
  }
  return n;
}
// Compile a module's source with AIR, exactly as an import does: { imports (its free names, the
// function's parameters after _py, in order), async, body (the function body's JS), doc }. Shared
// with gen-pyair.js, which precompiles the frozen hot set with it — so a build-time artifact is
// what the import would have compiled. ast: the source's, when the caller has it.
export function compileModuleSource(src, info = {}, ast = null) {
  const air = _airHooks();
  if (!air) throw new AdderRuntimeError('compiling a module needs @gcu/air: call attachAir(air) first');
  if (!ast) ast = adderParse(src);
  const mod = lowerAdder(ast, src, { module: { package: info.package || '', isBuiltin: _isBuiltinName } });
  air.runPasses(mod);
  const imports = [...(mod.imports || [])].filter((n) => !_JS_INTRINSICS.has(n));
  const body = air.emitJS(mod, ['_py', ...imports], [], { hinted: false });
  return { imports, async: !!air.needsAsync(mod), body, doc: _docOf(ast) };
}
// The compile cache: what compiling a source gave (its function — a factory: each run makes the
// module's objects afresh — or the error that sent it to the tree-walker), by kind, package and
// source text, least recently used dropped past _COMPILED_MAX characters of source + JS. Reused by
// a module imported again (another run, a reload), and by exec / eval of a string seen before
// (the __init__ dataclasses generates, namedtuple's __new__, a cell run again).
const _compiled = new Map();
let _compiledSize = 0;
const _COMPILED_MAX = 64 * 1024 * 1024;
// A persistent layer under it (setCompileStore): asked on a miss here, given each compile, so what
// AIR made of a source outlives the process. None by default: adder writes nowhere unless asked.
// A store is { get(key) → string | undefined, set(key, string) }, both sync; it keys by key plus
// its compiler's identity (@gcu/adder/node-cache: the files on disk, in Node). Process-wide.
let _compileStore = null;
export function setCompileStore(store) {
  if (store != null && (typeof store.get !== 'function' || typeof store.set !== 'function')) {
    throw new TypeError('setCompileStore: expected { get(key), set(key, value) } or null');
  }
  _compileStore = store || null;
}
// a stored entry, as the compile above would have made it ({ error } for a source AIR can't lower);
// anything unreadable is a miss
function _fromStore(key) {
  if (!_compileStore) return null;
  try {
    const s = _compileStore.get(key);
    if (typeof s !== 'string') return null;
    const r = JSON.parse(s);
    if (typeof r.fail === 'string') return { error: new Error(r.fail) };
    return Array.isArray(r.imports) && typeof r.body === 'string' ? r : null;
  } catch { return null; }
}
function _toStore(key, rec) {
  if (_compileStore) { try { _compileStore.set(key, JSON.stringify(rec)); } catch {} }
}
// a module's docstring: its first statement, when that is a string literal
function _docOf(ast) {
  const s = ast && ast.body && ast.body[0];
  return s && s.type === 'Expr' && s.value.type === 'Constant' && typeof s.value.value === 'string' ? s.value.value : null;
}
// the builtin namespace's names: what an imported module may read without defining
function _isBuiltinName(n) { return n in adderModules.builtins; }

export async function _airCall(compiled, opts, bindings) {
  const args = [_py, ...compiled.imports.map((name) => bindings[pyNameOf(name)])];
  const scope = await _withSandbox(opts, () => _withVfs(opts, () => compiled.fn(...args)));
  const out = {};
  if (scope && typeof scope === 'object') for (const k of Object.keys(scope)) if (k !== '__lastExpr__') out[pyNameOf(k)] = scope[k];
  return out;
}

// which engine runs this call, and why not AIR when it doesn't
function _pickEngine(opts) {
  const e = opts.engine || 'tree';
  if (e !== 'tree' && e !== 'air' && e !== 'auto') throw new TypeError(`run: engine must be 'tree', 'air' or 'auto', not ${JSON.stringify(e)}`);
  if (e === 'tree') return { engine: 'tree', why: 'asked' };
  if (opts.budget && typeof opts.budget.onStep === 'function') {
    if (e === 'air') throw new AdderRuntimeError("engine 'air' cannot honour budget.onStep (compiled code has no interpreter frames): use engine 'tree' to trace");
    return { engine: 'tree', why: 'trace' };
  }
  if (!_airLib) {
    if (e === 'air') throw new AdderRuntimeError("engine 'air' needs @gcu/air: call attachAir(air) first");
    return { engine: 'tree', why: 'no AIR attached' };
  }
  return { engine: e, why: null };
}

// Extract a plain object from an AdderScope, skipping names we injected as bindings.
// scope.vars is a Map; iterate to preserve insertion order and skip injected names.
function _scopeToObject(scope, bindings) {
  const result = {};
  if (scope.vars && typeof scope.vars.forEach === 'function') {
    scope.vars.forEach((v, k) => { if (!(k in bindings)) result[k] = v; });
  }
  return result;
}

// ── public API ──

/**
 * Execute adder source as a module. Returns the resulting scope as a plain object
 * mapping bound names to values.
 *
 * @param {string} code - adder source code
 * @param {object} [opts] - execution options
 * @param {object} [opts.globals] - names injected into scope
 * @param {object} [opts.locals] - names injected into scope (take precedence over globals)
 * @param {(...args) => void} [opts.print] - override for print()
 * @param {(s: string) => void} [opts.stdout] - where default print writes to
 * @param {(s: string) => void} [opts.stderr]
 * @param {() => string | Promise<string | null>} [opts.stdin] - reads next line for input()
 * @param {(prompt?) => string | Promise<string>} [opts.input] - override for input()
 * @param {object} [opts.vfs] - @gcu/vfs-shaped VFS for open(), os, pathlib, pathlib.Path
 * @param {boolean} [opts.host=true] - false removes the `js` module (no reach into globalThis)
 * @param {boolean} [opts.remote=true] - false turns off every import path that would call fetch()
 * @param {{steps?: number, ms?: number, onStep?: (ev: {line: number, kind: string, scope: object}) => void}} [opts.budget]
 *   - stop with AdderError('BudgetExceeded') after `steps` statements or `ms` wall-clock; onStep sees every statement
 * @param {'tree'|'air'|'auto'} [opts.engine='tree'] - tree-walk, AIR-compile (attachAir first), or AIR when it can
 * @param {(engine: 'tree'|'air', why: string|null) => void} [opts.onEngine] - told which engine ran, and why not AIR
 * @returns {Promise<Record<string, any>>} the module scope
 */
export async function run(code, opts = {}) {
  const src = _dedent(code);
  const ast = adderParse(src);
  // the program is __main__ (sys.modules['__main__']: click and argparse read it)
  const mods = adderModules.sys && adderModules.sys.modules;
  if (mods && !mods.__main__) mods.__main__ = { __adderModule__: true, __name__: '__main__', __package__: null, __spec__: null, __loader__: null, __doc__: null };
  const bindings = _makeBindings(opts);
  let pick = _pickEngine(opts);
  if (pick.engine !== 'tree') {
    let compiled = null;
    try { compiled = _airCompile(ast, src, !!opts.budget); } catch (e) {
      if (pick.engine === 'air') throw e;
      pick = { engine: 'tree', why: `not compiled: ${String(e && e.message || e).split('\n')[0]}` };
    }
    if (compiled) {
      const missing = compiled.imports.filter((n) => !(pyNameOf(n) in bindings));
      if (missing.length && pick.engine === 'auto') pick = { engine: 'tree', why: `free name ${missing[0]}` };
      else {
        if (opts.onEngine) opts.onEngine('air', null);
        return await _airCall(compiled, opts, bindings);
      }
    }
  }
  if (opts.onEngine) opts.onEngine('tree', pick.why);
  const scope = new AdderScope();
  for (const [k, v] of Object.entries(bindings)) scope.set(k, v);
  return await _withSandbox(opts, () => _withVfs(opts, async () => {
    await adderEval(ast, scope);
    return _scopeToObject(scope, bindings);
  }));
}

/**
 * Evaluate a single adder expression and return its value.
 *
 * @param {string} code - adder expression (not a statement)
 * @param {object} [opts] - same shape as run()
 * @returns {Promise<any>} the expression value
 */
export async function evalExpr(code, opts = {}) {
  const ast = _adderParseExpr(_dedent(code).trim());
  const scope = new AdderScope();
  const bindings = _makeBindings(opts);
  for (const [k, v] of Object.entries(bindings)) scope.set(k, v);
  return await _withSandbox(opts, () => _withVfs(opts, async () => adderEval(ast, scope)));
}

/**
 * Compile once, run many. Useful for REPLs and batch jobs that re-execute
 * the same code with different bindings.
 *
 * @param {string} code - adder source code
 * @returns {{ ast: object, run(opts?): Promise<Record<string, any>> }}
 */
export function compile(code) {
  const ast = adderParse(_dedent(code));
  return {
    ast,
    async run(opts = {}) {
      const scope = new AdderScope();
      const bindings = _makeBindings(opts);
      for (const [k, v] of Object.entries(bindings)) scope.set(k, v);
      return await _withSandbox(opts, () => _withVfs(opts, async () => {
        await adderEval(ast, scope);
        return _scopeToObject(scope, bindings);
      }));
    },
  };
}

/**
 * Test if adder source parses completely. Returns true if the parser
 * would want more input (open block, unclosed bracket, etc.). REPL loops
 * use this to decide whether to prompt for a continuation line.
 *
 * @param {string} code - adder source code
 * @returns {boolean} true if more input is needed
 */
export function isIncomplete(code) {
  if (code == null || code === '' || /^\s*$/.test(code)) return true;
  try {
    adderParse(_dedent(code));
    return false;
  } catch (e) {
    const msg = (e && e.message) || '';
    // Parser error patterns indicating the parser ran out of input mid-construct:
    //   "Expected INDENT, got '' [EOF]"          — block body missing
    //   "Expected X, got '' [NEWLINE]" or [EOF]  — unclosed bracket, missing operand
    //   "Unexpected token: NEWLINE ''"           — trailing comma in collection
    //   "Unexpected end of file"                 — generic EOF
    return /got '' \[|''\s*\(line|\bEOF\b|[Uu]nexpected end/.test(msg);
  }
}

export { AdderRuntimeError, registerModule, unregisterModule };

// the bindings run() builds, for @gcu/adder/air's compile().run
export { _makeBindings as _makeBindingsForAir };
