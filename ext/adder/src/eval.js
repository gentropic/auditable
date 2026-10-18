// adder v2 — tree-walking evaluator
// Evaluates AST nodes produced by the parser. All values are native JS values.

import { adderParse, _adderParseExpr, compileMatchPattern, classNeedsCell } from './parse.js';
// the stdlib modules register themselves into adderModules (the concat build lists them in main.js)
import './stdlib.js';
import './stdlib-types.js';
import './stdlib-num.js';
import './stdlib-time.js';
import './stdlib-data.js';
import './stdlib-sys.js';
import './stdlib-pickle.js';
import './stdlib-net.js';
import './stdlib-py.js';
import {
  AdderError, AdderRange, Complex, adderBuiltins, adderModules, adderGetAttr,
  pyBool, pyBoolMaybe, pyTypeName, pyStr, pyRepr, pyIter, pyCollect, pyFormatValue,
  _excParents, getAdderVFS, _getVfsPath,
  _builtinEval, _builtinExec, _builtinSuper, _builtinGlobals, _builtinLocals,
  pyStrMaybe, pyReprMaybe, pyEq, pyNe, pyLt, pyLe, pyGt, pyGe,
  excToThrowable, excValue, excMatches, excTypeOf, initExceptionInstance, pySuper,
  isUserIterable, pyIterAsync, pyBinOps, pyIAddBuiltin, pyNeg, pyPos, pyInvert, pyGetItem, pyRangeSlice, bytesLit,
  _registerImportMachinery, stdoutWrite, frozenPyModules, stopIteration, setScopeExec, awaitTarget, PyByteArray, buildClass, classStatement, computeMRO, PyTuple, PyDict, PySet, mkTuple, isPlainDict, plainObjectKey, finishClass, classAnnotations, storeAttr, pyDelItem, pyDelAttr, seqStoreIndex, NO_DEFAULT, LiveDefaults, setRedirectBuilder, setClassAttr, excStack, pyMatch, AttrDict, subclassDunder, PyCell, ctxEnter, ctxExit, pyAIter,
} from './builtins.js';

// the exceptions being handled (innermost last): a bare `raise` re-raises the top one
const _excStack = excStack;   // shared with the AIR runtime (builtins.js)

// ── scope ──

export class AdderScope {
  constructor(parent = null) {
    this.vars = new PyDict();
    this.parent = parent;
    this.globals = new PySet();
    this.nonlocals = new PySet();
  }
  get(name) {
    if (this.globals.has(name)) return this._getGlobal(name);
    if (name === '__class__' && (this.nonlocals.has(name) || !this.vars.has(name))) {
      const c = this._classCellOf();
      if (c) return c.get();
    }
    if (this.nonlocals.has(name)) return this._getEnclosing(name);
    if (this.vars.has(name)) return this.vars.get(name);
    const p = this._outer(name);
    if (p) return p.get(name);
    if (this._builtins && Object.hasOwn(this._builtins, name)) return this._builtins[name];
    throw new AdderError('NameError', `name '${name}' is not defined`);
  }
  // the enclosing scope a name is looked up in next: a class body's names are not visible to
  // the functions (and comprehensions) inside it — only to the body itself
  _outer(name) {
    let p = this.parent;
    while (p && p._isClass) p = p.parent;
    return p;
  }
  // `__class__` from here (not bound in this scope): the nearest enclosing class's cell, or an
  // enclosing function's own `__class__` — as { get, set, del }; null when there's neither
  _classCellOf() {
    for (let p = this.parent; p; p = p.parent) {
      if (p._isClass) {
        const cell = p._classCell;
        if (!cell) continue;
        return {
          get: () => {
            if (cell._v === undefined) throw new AdderError('NameError', "cannot access free variable '__class__' where it is not associated with a value in enclosing scope");
            return cell._v;
          },
          set: (v) => { cell._v = v; },
          del: () => { cell._v = undefined; },
          cell,
        };
      }
      if (p.globals.has('__class__')) return null;
      if (p.vars.has('__class__')) return { get: () => p.vars.get('__class__'), set: (v) => p.vars.set('__class__', v), del: () => p.vars.delete('__class__') };
    }
    return null;
  }
  set(name, value) {
    if (this.globals.has(name)) { this._setGlobal(name, value); return; }
    if (name === '__class__' && this.nonlocals.has(name)) { const c = this._classCellOf(); if (c) { c.set(value); return; } }
    if (this.nonlocals.has(name)) { this._setEnclosing(name, value); return; }
    this.vars.set(name, value);
  }
  has(name) {
    if (this.vars.has(name)) return true;
    const p = this._outer(name);
    if (p) return p.has(name);
    return !!(this._builtins && Object.hasOwn(this._builtins, name));
  }
  delete(name) {
    if (name === '__class__' && this.nonlocals.has(name)) { const c = this._classCellOf(); if (c) { c.del(); return; } }
    this.vars.delete(name);
  }
  _getGlobal(name) {
    let s = this; while (s.parent) s = s.parent;
    if (s.vars.has(name)) return s.vars.get(name);
    if (s._builtins && Object.hasOwn(s._builtins, name)) return s._builtins[name];
    throw new AdderError('NameError', `name '${name}' is not defined`);
  }
  _setGlobal(name, value) { let s = this; while (s.parent) s = s.parent; s.vars.set(name, value); }
  _getEnclosing(name) {
    let s = this.parent;
    while (s) { if (!s._isClass && s.vars.has(name)) return s.vars.get(name); s = s.parent; }
    throw new AdderError('NameError', `name '${name}' is not defined`);
  }
  _setEnclosing(name, value) {
    let s = this.parent;
    while (s) { if (!s._isClass && s.vars.has(name)) { s.vars.set(name, value); return; } s = s.parent; }
    throw new AdderError('NameError', `name '${name}' is not defined`);
  }
}

// ── control flow signals ──

class _BreakSignal { }
class _ContinueSignal { }
class _ReturnSignal { constructor(value) { this.value = value; } }

// ── run options (sandbox) ──
// Set per call by the runner (run / evalExpr / compile().run) and restored on
// exit, the way the VFS is. `host: false` hides the `js` module; `remote:
// false` turns off every path that would call fetch(); `budget` stops runaway
// code at statement boundaries and offers a per-statement hook (the trace a
// host like golem hangs its "line + changed names" table from).
let _runOpts = { host: true, remote: true };
export function _getRunOptions() { return _runOpts; }
export function _setRunOptions(o) { const prev = _runOpts; _runOpts = o || { host: true, remote: true }; return prev; }

// budget: { limit, deadline, onStep, count, spent } — one increment per statement
// node, a wall-clock check every 256, and once exceeded it stays exceeded (code
// that catches BudgetExceeded cannot resume: the next boundary raises again).
let _budget = null;
export function _setBudget(b) { const prev = _budget; _budget = b; return prev; }
export function _makeBudget(spec) {
  if (!spec) return null;
  const steps = spec.steps != null ? Math.max(1, +spec.steps) : Infinity;
  const ms = spec.ms != null ? Math.max(1, +spec.ms) : Infinity;
  return { limit: steps, deadline: ms === Infinity ? Infinity : _now() + ms, ms, onStep: typeof spec.onStep === 'function' ? spec.onStep : null, count: 0, spent: null };
}
const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const _STMT = new PySet(['Expr', 'Assign', 'AugAssign', 'AnnAssign', 'If', 'For', 'While', 'With', 'FunctionDef', 'AsyncFunctionDef', 'ClassDef', 'Return', 'Pass', 'Break', 'Continue', 'Import', 'ImportFrom', 'Raise', 'Try', 'Assert', 'Delete', 'Global', 'Nonlocal']);
// the read-only view of the current frame handed to onStep — one object, re-aimed
// per statement (not a copy; the caller copies what it wants)
const _view = {
  scope: null,
  has(name) { return this.scope.vars.has(name); },
  get(name) { return this.scope.vars.get(name); },
  names() { return [...this.scope.vars.keys()]; },
  entries() { return [...this.scope.vars]; },
};
function _tick(node, scope) {
  const b = _budget;
  if (b.spent) throw new AdderError('BudgetExceeded', b.spent, node.line);
  b.count++;
  if (b.count > b.limit) { b.spent = `${b.limit} statements`; throw new AdderError('BudgetExceeded', b.spent, node.line); }
  if (b.deadline !== Infinity && (b.count & 255) === 0 && _now() > b.deadline) { b.spent = `${b.ms} ms`; throw new AdderError('BudgetExceeded', b.spent, node.line); }
  if (b.onStep) { _view.scope = scope; b.onStep({ line: node.line, kind: node.type, scope: _view }); }
}

// The same budget for AIR-compiled code: the lowerer (ticks: true) emits _py.tick(line)
// before every statement, so `steps` counts statements exactly as the tree-walker does.
// No onStep here: compiled code has no interpreter frame to show (trace runs tree-walking).
export function _tickLine(line) {
  const b = _budget;
  if (b === null) return;
  if (b.spent) throw new AdderError('BudgetExceeded', b.spent, line);
  b.count++;
  if (b.count > b.limit) { b.spent = `${b.limit} statements`; throw new AdderError('BudgetExceeded', b.spent, line); }
  if (b.deadline !== Infinity && (b.count & 255) === 0 && _now() > b.deadline) { b.spent = `${b.ms} ms`; throw new AdderError('BudgetExceeded', b.spent, line); }
}

// ── module registry (sandbox) ──
// A host with no `window` (a worker, a Node test) makes a module importable
// here; `_resolveModule` looks here FIRST, before the built-ins and before
// window._auditableExtensions. Process-wide, like adderModules. Dotted names
// walk into the registered object (`from natra.linalg import inv` → mod.linalg).
const _registered = new PyDict();
export function registerModule(name, mod) {
  if (typeof name !== 'string' || !name) throw new TypeError('registerModule: name must be a non-empty string');
  if (mod == null) throw new TypeError(`registerModule('${name}'): module must be an object`);
  _registered.set(name, mod);
  return mod;
}
export function unregisterModule(name) { return _registered.delete(name); }
function _walkDotted(root, name) {
  const dot = name.indexOf('.');
  if (dot === -1) return null;
  let mod = root(name.slice(0, dot));
  if (!mod) return null;
  for (const part of name.slice(dot + 1).split('.')) {
    if (mod == null || (typeof mod !== 'object' && typeof mod !== 'function')) return null;
    mod = mod[part];
  }
  return mod && (typeof mod === 'object' || typeof mod === 'function') ? mod : null;
}

// ── evaluator ──

export async function adderEval(node, scope) {
  if (!node) return null;
  if (_budget !== null && node.line != null && _STMT.has(node.type)) _tick(node, scope);
  switch (node.type) {
    case 'Module': return _evalModule(node, scope);
    case 'Expr': return adderEval(node.value, scope);
    case 'Constant': {
      const v = node.value;
      if (v && typeof v === 'object' && v._complex) return new Complex(0, v.imag);
      return v;
    }
    case 'Name': return scope.get(node.id);
    case 'Pass': return null;
    case 'Break': throw new _BreakSignal();
    case 'Continue': throw new _ContinueSignal();
    case 'Return': throw new _ReturnSignal(node.value ? await adderEval(node.value, scope) : null);

    // ── assignments ──
    case 'Assign': {
      const value = await adderEval(node.value, scope);
      for (const target of node.targets) await _assignTarget(target, value, scope);
      return null;
    }
    case 'AugAssign': {
      const current = await _evalTarget(node.target, scope);
      const value = await adderEval(node.value, scope);
      const iDunder = _iDunders[node.op];
      let result;
      if (iDunder && current !== null && typeof current === 'object' && typeof current[iDunder] === 'function') {
        result = current[iDunder](value);
      } else if (node.op === '+' && Array.isArray(current) && !(current instanceof PyTuple)) {
        result = pyIAddBuiltin(current, value);   // list += iterable extends in place
      } else {
        result = _binOp(node.op, current, value, node.line);
      }
      await _assignTarget(node.target, result, scope);
      return null;
    }
    case 'AnnAssign': {
      if (node.value) {
        const value = await adderEval(node.value, scope);
        await _assignTarget(node.target, value, scope);
      }
      return null;
    }

    // ── control flow ──
    case 'If': {
      const test = await adderEval(node.test, scope);
      if (await pyBoolMaybe(test)) { for (const s of node.body) await adderEval(s, scope); }
      else { for (const s of node.orelse) await adderEval(s, scope); }
      return null;
    }
    case 'For': return _evalFor(node, scope);
    case 'While': return _evalWhile(node, scope);
    case 'With': return _evalWith(node, scope);

    // ── functions / classes ──
    case 'FunctionDef': case 'AsyncFunctionDef': {
      // decorators are evaluated before the defaults and the function (Python's order)
      const decs = [];
      for (const d of node.decorators) decs.push(await adderEval(d, scope));
      let fn = _makeFunction(node, scope, await _evalDefaults(node, scope));
      for (let i = decs.length - 1; i >= 0; i--) fn = await _callValue(decs[i], [fn], [], node.line);
      scope.set(node.name, fn);
      return null;
    }
    case 'ClassDef': return _evalClass(node, scope);
    case 'Lambda': return _makeLambda(node, scope, await _evalDefaults(node, scope));

    // ── exceptions ──
    case 'Try': return _evalTry(node, scope);
    case 'Match': { const c = await _matchCase(node, scope); if (c) for (const s of c.body) await adderEval(s, scope); return null; }
    case 'Raise': {
      if (!node.exc) {
        if (_excStack.length) throw _excStack[_excStack.length - 1];
        throw new AdderError('RuntimeError', 'No active exception to reraise', node.line);
      }
      const err = await excToThrowable(await adderEval(node.exc, scope), node.line);
      if (node.hasCause) {
        const c = await adderEval(node.cause, scope);
        const cause = c === null ? null : excValue(await excToThrowable(c, node.line));
        err.__cause__ = cause;
        if (err.pyValue && typeof err.pyValue === 'object') err.pyValue.__cause__ = cause;
      }
      throw err;
    }
    case 'Assert': {
      const test = await adderEval(node.test, scope);
      if (!await pyBoolMaybe(test)) {
        const msg = node.msg ? await pyStrMaybe(await adderEval(node.msg, scope)) : '';
        throw new AdderError('AssertionError', msg, node.line);
      }
      return null;
    }

    // ── scope declarations ──
    case 'Global': { for (const n of node.names) scope.globals.add(n); return null; }
    case 'Nonlocal': { for (const n of node.names) scope.nonlocals.add(n); return null; }
    case 'Delete': { for (const t of node.targets) await _deleteTarget(t, scope); return null; }

    // ── imports ──
    case 'Import': return _evalImport(node, scope);
    case 'ImportFrom': return _evalImportFrom(node, scope);

    // ── expressions ──
    case 'BinOp': {
      const left = await adderEval(node.left, scope);
      const right = await adderEval(node.right, scope);
      return _binOp(node.op, left, right, node.line);
    }
    case 'UnaryOp': {
      const operand = await adderEval(node.operand, scope);
      if (node.op === '-') return _withLine(() => pyNeg(operand), node.line);
      if (node.op === '+') return _withLine(() => pyPos(operand), node.line);
      if (node.op === '~') return _withLine(() => pyInvert(operand), node.line);
      if (node.op === 'not') return !await pyBoolMaybe(operand);
      throw new AdderError('TypeError', `unsupported unary op: ${node.op}`, node.line);
    }
    case 'BoolOp': {
      if (node.op === 'or') {
        let result;
        for (const v of node.values) { result = await adderEval(v, scope); if (await pyBoolMaybe(result)) return result; }
        return result;
      }
      let result;
      for (const v of node.values) { result = await adderEval(v, scope); if (!await pyBoolMaybe(result)) return result; }
      return result;
    }
    case 'Compare': {
      let left = await adderEval(node.left, scope);
      // single comparison: return dunder result directly (e.g. BooleanMask from Series.__gt__)
      if (node.ops.length === 1) {
        const right = await adderEval(node.comparators[0], scope);
        return _compareOp(node.ops[0], left, right);
      }
      // chained comparisons: coerce to boolean (a < b < c → a < b and b < c)
      for (let i = 0; i < node.ops.length; i++) {
        const right = await adderEval(node.comparators[i], scope);
        if (!(await _compareOp(node.ops[i], left, right))) return false;
        left = right;
      }
      return true;
    }
    case 'IfExp': {
      const test = await adderEval(node.test, scope);
      return await pyBoolMaybe(test) ? adderEval(node.body, scope) : adderEval(node.orelse, scope);
    }

    // ── calls ──
    case 'Call': return _evalCall(node, scope);

    // ── attribute / subscript ──
    case 'Attribute': {
      const obj = await adderEval(node.value, scope);
      return adderGetAttr(obj, node.attr);
    }
    case 'Subscript': return _evalSubscript(node, scope);

    // ── collections ──
    case 'List': { const elts = []; for (const e of node.elts) { if (e.type === 'Starred') { for (const v of pyIter(await adderEval(e.value, scope))) elts.push(v); } else elts.push(await adderEval(e, scope)); } return elts; }
    case 'Tuple': { const elts = []; for (const e of node.elts) { if (e.type === 'Starred') { for (const v of pyIter(await adderEval(e.value, scope))) elts.push(v); } else elts.push(await adderEval(e, scope)); } return mkTuple(elts); }
    case 'Dict': {
      // A literal whose keys are all string constants is a plain object, so JS cells read it
      // as d.a. An EMPTY literal is a PyDict: it is filled with data keys later, and a plain
      // object would turn d[5] into d['5'] and order integer-like keys first.
      const allStringKeys = node.keys.length > 0 && node.keys.every(k => k && (k.type === 'Constant' && plainObjectKey(k.value)) || k === null);
      if (allStringKeys) {
        const obj = {};
        for (let i = 0; i < node.keys.length; i++) {
          if (node.keys[i] === null) { // **unpack
            const src = await adderEval(node.values[i], scope);
            if (src instanceof Map) { for (const [k, v] of src) obj[k] = v; }
            else { Object.assign(obj, src); }
          } else {
            obj[await adderEval(node.keys[i], scope)] = await adderEval(node.values[i], scope);
          }
        }
        return obj;
      }
      const map = new PyDict();
      for (let i = 0; i < node.keys.length; i++) {
        if (node.keys[i] === null) {
          const src = await adderEval(node.values[i], scope);
          if (src instanceof Map) { for (const [k, v] of src) map.set(k, v); }
          else if (isPlainDict(src)) { for (const k of Object.keys(src)) map.set(k, src[k]); }
          else if (src && typeof src.keys === 'function' && typeof src.__getitem__ === 'function') {
            for (const k of await pyCollect(await src.keys())) map.set(k, await src.__getitem__(k));
          } else throw new AdderError('TypeError', `'${pyTypeName(src)}' object is not a mapping`);
        } else {
          map.set(await adderEval(node.keys[i], scope), await adderEval(node.values[i], scope));
        }
      }
      return map;
    }
    case 'Set': {
      const s = new PySet();
      for (const e of node.elts) {
        if (e.type === 'Starred') { for (const v of await pyCollect(await adderEval(e.value, scope))) s.add(v); }
        else s.add(await adderEval(e, scope));
      }
      return s;
    }

    // ── comprehensions ──
    case 'ListComp': return _evalComp(node, scope, 'list');
    case 'SetComp': return _evalComp(node, scope, 'set');
    case 'DictComp': return _evalComp(node, scope, 'dict');
    case 'GeneratorExp': return _evalGenExpr(node, scope);

    case 'Bytes': return bytesLit(node.value);

    // ── f-strings ──
    case 'JoinedStr': {
      let result = '';
      for (const v of node.values) result += await adderEval(v, scope);
      return result;
    }
    case 'FormattedValue': {
      // tree-walked methods are async, so a user __str__ / __repr__ gives a Promise:
      // the *Maybe formatters await it (and stay plain strings for everything else)
      let val = await adderEval(node.value, scope);
      if (node.conversion === 'r') val = await pyReprMaybe(val);
      else if (node.conversion === 's') val = await pyStrMaybe(val);
      // a nested spec (`{x:>{w}}`) is itself an f-string, evaluated first
      const spec = node.formatSpec && typeof node.formatSpec === 'object' ? await adderEval(node.formatSpec, scope) : node.formatSpec;
      return spec ? pyFormatValue(val, spec) : await pyStrMaybe(val);
    }

    // ── await ──
    case 'Await': return await awaitTarget(await adderEval(node.value, scope));
    case 'Yield': throw new AdderError('SyntaxError', 'yield outside function', node.line);
    case 'YieldFrom': throw new AdderError('SyntaxError', 'yield outside function', node.line);
    case 'NamedExpr': {
      // (name := value) binds in the enclosing function or module scope, even from inside a
      // comprehension (PEP 572), so the name is readable after the comprehension ends
      const value = await adderEval(node.value, scope);
      let target = scope;
      while (target._isComp && target.parent) target = target.parent;
      target.set(node.target.id, value);
      return value;
    }

    // ── starred (in expression context) ──
    case 'Starred': return await adderEval(node.value, scope);

    // ── slice (standalone) ──
    case 'Slice': return { _slice: true, lower: node.lower ? await adderEval(node.lower, scope) : null, upper: node.upper ? await adderEval(node.upper, scope) : null, step: node.step ? await adderEval(node.step, scope) : null };

    default:
      throw new AdderError('RuntimeError', `Unknown AST node type: ${node.type}`, node.line);
  }
}

// ── module execution ──

async function _evalModule(node, scope) {
  let lastExpr = undefined;
  for (let i = 0; i < node.body.length; i++) {
    const stmt = node.body[i];
    if (i === node.body.length - 1 && stmt.type === 'Expr') {
      if (_budget !== null) _tick(stmt, scope);
      lastExpr = await adderEval(stmt.value, scope);
    } else {
      await adderEval(stmt, scope);
    }
  }
  return lastExpr;
}

// ── assignment / target helpers ──

async function _assignTarget(target, value, scope) {
  switch (target.type) {
    case 'Name': scope.set(target.id, value); break;
    case 'Attribute': {
      const obj = await adderEval(target.value, scope);
      // check for @property setter on prototype chain (async — can't use JS setter directly)
      for (let p = Object.getPrototypeOf(obj); p; p = Object.getPrototypeOf(p)) {
        const d = Object.getOwnPropertyDescriptor(p, target.attr);
        if (d?.set?._pyFset) { await d.set._pyFset(obj, value); return null; }
        if (d) break;
      }
      await storeAttr(obj, target.attr, value);
      break;
    }
    case 'Subscript': {
      const obj = await adderEval(target.value, scope);
      if (obj instanceof PyTuple) throw new AdderError('TypeError', `'${pyTypeName(obj)}' object does not support item assignment`, target.line);
      if (target.slice.type === 'Slice') {
        const lower = target.slice.lower ? await adderEval(target.slice.lower, scope) : null;
        const upper = target.slice.upper ? await adderEval(target.slice.upper, scope) : null;
        const step = target.slice.step ? await adderEval(target.slice.step, scope) : null;
        if (typeof obj?.__setitem__ === 'function') {
          await obj.__setitem__({ _slice: true, lower, upper, step }, value);
        } else {
          _applySliceAssign(obj, lower, upper, step, value, target.line);
        }
        break;
      }
      if (target.slice.type === 'Tuple') {
        const raw = [];
        for (const elt of target.slice.elts) {
          raw.push(await _evalSliceElt(elt, scope));
        }
        const key = mkTuple(raw);
        if (obj instanceof Map) { obj.set(key, value); break; }
        if (isPlainDict(obj)) { obj[key] = value; break; }
        if (obj && typeof obj.__setitem__ === 'function') {
          await obj.__setitem__(key, value);
          break;
        }
        // Generic 2D-ndarray-shape tuple setitem — same shape support
        // as the read path. Lets learn / scitra outputs accept
        // `x[:, 1] = 0.0` etc. without per-library setters.
        if (obj && Array.isArray(obj.shape) && obj.shape.length === 2
            && (obj.data instanceof Float64Array || obj instanceof Float64Array)) {
          const [n, m] = obj.shape;
          const d = obj instanceof Float64Array ? obj : obj.data;
          const rk = key[0], ck = key[1];
          const _bcast = (write, len) => {
            if (value != null && typeof value !== 'string'
                && typeof value[Symbol.iterator] === 'function') {
              const flat = [...value];
              if (flat.length !== len) {
                throw new AdderError('ValueError', `cannot broadcast ${flat.length} values to ${len} positions`);
              }
              for (let i = 0; i < len; i++) write(i, flat[i]);
            } else {
              for (let i = 0; i < len; i++) write(i, value);
            }
          };
          if (typeof rk === 'number' && typeof ck === 'number') {
            d[(rk < 0 ? n + rk : rk) * m + (ck < 0 ? m + ck : ck)] = value;
            break;
          }
          if (rk && rk._slice && typeof ck === 'number') {
            const lo = rk.lower != null ? rk.lower : 0;
            const hi = rk.upper != null ? Math.min(rk.upper, n) : n;
            const j = ck < 0 ? m + ck : ck;
            _bcast((i, v) => { d[(lo + i) * m + j] = v; }, hi - lo);
            break;
          }
          if (typeof rk === 'number' && ck && ck._slice) {
            const i = rk < 0 ? n + rk : rk;
            const lo = ck.lower != null ? ck.lower : 0;
            const hi = ck.upper != null ? Math.min(ck.upper, m) : m;
            _bcast((k, v) => { d[i * m + lo + k] = v; }, hi - lo);
            break;
          }
        }
        throw new AdderError('TypeError',
          `'${pyTypeName(obj)}' object does not support tuple item assignment`,
          target.line);
      }
      const key = await adderEval(target.slice, scope);
      if (obj instanceof Map) obj.set(key, value);
      else if (typeof obj?.__setitem__ === 'function') await obj.__setitem__(key, value);
      else if (Array.isArray(obj) || obj instanceof Uint8Array) {
        // Python-style indexing on write: arr[-1] is the last element (JS would store a '-1'
        // property), a position past the end is an IndexError
        obj[_withLine(() => seqStoreIndex(obj, key), target.line)] = value;
      }
      else obj[key] = value;
      break;
    }
    case 'Tuple': case 'List': {
      const items = [...pyIter(value)];
      const starIdx = target.elts.findIndex(e => e.type === 'Starred');
      if (starIdx >= 0) {
        // starred unpacking
        const before = target.elts.slice(0, starIdx);
        const after = target.elts.slice(starIdx + 1);
        for (let i = 0; i < before.length; i++) await _assignTarget(before[i], items[i], scope);
        const starItems = items.slice(before.length, items.length - after.length);
        await _assignTarget(target.elts[starIdx].value, starItems, scope);
        for (let i = 0; i < after.length; i++) await _assignTarget(after[i], items[items.length - after.length + i], scope);
      } else {
        for (let i = 0; i < target.elts.length; i++) await _assignTarget(target.elts[i], items[i], scope);
      }
      break;
    }
    case 'Starred': await _assignTarget(target.value, value, scope); break;
    default: throw new AdderError('RuntimeError', `Cannot assign to ${target.type}`);
  }
}

async function _evalTarget(target, scope) {
  if (target.type === 'Name') return scope.get(target.id);
  // the attribute as Python reads it (a class variable, a property, __getattr__), for `x.a += 1`
  if (target.type === 'Attribute') { const obj = await adderEval(target.value, scope); return adderGetAttr(obj, target.attr); }
  if (target.type === 'Subscript') { return _evalSubscript(target, scope); }
  throw new AdderError('RuntimeError', `Cannot read target ${target.type}`);
}

async function _deleteTarget(target, scope) {
  if (target.type === 'Name') { scope.delete(target.id); return; }
  if (target.type === 'Attribute') { const obj = await adderEval(target.value, scope); await pyDelAttr(obj, target.attr); return; }
  if (target.type === 'Subscript') {
    const obj = await adderEval(target.value, scope);
    if (target.slice.type === 'Slice') {
      const lower = target.slice.lower ? await adderEval(target.slice.lower, scope) : null;
      const upper = target.slice.upper ? await adderEval(target.slice.upper, scope) : null;
      const step = target.slice.step ? await adderEval(target.slice.step, scope) : null;
      if (typeof obj?.__delitem__ === 'function') {
        await obj.__delitem__({ _slice: true, lower, upper, step });
      } else {
        _applySliceDelete(obj, lower, upper, step, target.line);
      }
      return;
    }
    const key = target.slice.type === 'Tuple' ? mkTuple(await Promise.all(target.slice.elts.map((e) => adderEval(e, scope)))) : await adderEval(target.slice, scope);
    await pyDelItem(obj, key);
    return;
  }
}

// ── binary operations ──

// binary operators: the shared rules (builtins.js); an error gets this node's line
function _withLine(fn, line) {
  try { return fn(); } catch (e) {
    if (e instanceof AdderError && !e.adderLine && line) { e.adderLine = line; e.message += ` (line ${line})`; }
    throw e;
  }
}
function _binOp(op, left, right, line) {
  const fn = pyBinOps[op];
  if (!fn) throw new AdderError('TypeError', `unsupported operator: ${op}`, line);
  return _withLine(() => fn(left, right), line);
}

const _dunders = {
  '+': '__add__', '-': '__sub__', '*': '__mul__', '/': '__truediv__',
  '//': '__floordiv__', '%': '__mod__', '**': '__pow__',
  '&': '__and__', '|': '__or__', '^': '__xor__',
  '<<': '__lshift__', '>>': '__rshift__', '@': '__matmul__',
};

const _rdunders = {
  '+': '__radd__', '-': '__rsub__', '*': '__rmul__', '/': '__rtruediv__',
  '//': '__rfloordiv__', '%': '__rmod__', '**': '__rpow__', '@': '__rmatmul__',
};

const _iDunders = {
  '+': '__iadd__', '-': '__isub__', '*': '__imul__', '/': '__itruediv__',
  '//': '__ifloordiv__', '%': '__imod__', '**': '__ipow__',
  '&': '__iand__', '|': '__ior__', '^': '__ixor__',
  '<<': '__ilshift__', '>>': '__irshift__', '@': '__imatmul__',
};

// ── comparison ──

function _compareOp(op, left, right) {
  switch (op) {
    case '==': return pyEq(left, right);
    case '!=': return pyNe(left, right);
    case '<': return pyLt(left, right);
    case '<=': return pyLe(left, right);
    case '>': return pyGt(left, right);
    case '>=': return pyGe(left, right);
    case 'in': return _pyIn(right, left);
    case 'not in': return !_pyIn(right, left);
    case 'is': return left === right;
    case 'is not': return left !== right;
    default: throw new AdderError('TypeError', `unsupported comparison: ${op}`);
  }
}

function _pyEq(a, b) {
  return pyEq(a, b);
}
function _pyIn(container, value) {
  if (typeof container === 'string') return container.includes(String(value));
  { const f = subclassDunder(container, '__contains__'); if (f) return f.call(container, value); }
  if (Array.isArray(container)) return container.some(v => _pyEq(v, value));
  if (container instanceof Map) return container.has(value);
  if (container instanceof Set) return container.has(value);
  if (container instanceof AdderRange) return container.includes(value);
  if (container !== null && (typeof container === 'object' || typeof container === 'function' && typeof container.__contains__ === 'function')) {
    if (typeof container.__contains__ === 'function') return container.__contains__(value);
    return value in container;
  }
  throw new AdderError('TypeError', `argument of type '${pyTypeName(container)}' is not iterable`);
}

// ── subscript ──

// Evaluate one element of a tuple subscript. A Slice element produces
// the `{_slice: true, lower, upper, step}` marker object that
// __getitem__/__setitem__ already recognize; everything else evaluates
// as a normal expression. Used by both the read and write paths.
async function _evalSliceElt(elt, scope) {
  if (elt && elt.type === 'Slice') {
    return {
      _slice: true,
      lower: elt.lower ? await adderEval(elt.lower, scope) : null,
      upper: elt.upper ? await adderEval(elt.upper, scope) : null,
      step: elt.step ? await adderEval(elt.step, scope) : null,
    };
  }
  return await adderEval(elt, scope);
}

async function _evalSubscript(node, scope) {
  const obj = await adderEval(node.value, scope);
  if (node.slice.type === 'Slice') {
    const lower = node.slice.lower ? await adderEval(node.slice.lower, scope) : null;
    const upper = node.slice.upper ? await adderEval(node.slice.upper, scope) : null;
    const step = node.slice.step ? await adderEval(node.slice.step, scope) : null;
    if (typeof obj === 'string' || Array.isArray(obj) || obj instanceof Uint8Array)
      return _applySlice(obj, lower, upper, step);
    if (typeof obj?.__getitem__ === 'function')
      return obj.__getitem__({ _slice: true, lower, upper, step });
    return _applySlice(obj, lower, upper, step);
  }
  // x[*a, b]: the key is that tuple, starred items spliced in
  if (node.slice.type === 'Tuple' && node.slice.elts.some((e) => e.type === 'Starred')) {
    const key = await adderEval(node.slice, scope);
    return _withLine(() => pyGetItem(obj, key), node.line);
  }
  // Tuple subscript — numpy / pandas multi-dim access. `arr[i, j]` is
  // sugar for `arr[(i, j)]`; pass the array of evaluated items to
  // __getitem__ and let the target (ndarray, DataFrame, etc.) handle.
  // Falls back to a generic 2D ndarray-shape path (`{data, shape}`)
  // when __getitem__ isn't defined — covers learn / scitra outputs.
  if (node.slice.type === 'Tuple') {
    const raw = [];
    for (const elt of node.slice.elts) {
      raw.push(await _evalSliceElt(elt, scope));
    }
    const key = mkTuple(raw);
    if (obj && typeof obj.__getitem__ === 'function') return obj.__getitem__(key);
    if (obj instanceof Map || isPlainDict(obj)) return _withLine(() => pyGetItem(obj, key), node.line);
    // Generic 2D-ndarray-shape tuple subscript — accepts either a
    // wrapper `{data: Float64Array, shape}` or a bare Float64Array
    // with `.shape` tacked on (learn's transformer outputs).
    if (obj && Array.isArray(obj.shape) && obj.shape.length === 2
        && (obj.data instanceof Float64Array || obj instanceof Float64Array)) {
      const [n, m] = obj.shape;
      const d = obj instanceof Float64Array ? obj : obj.data;
      const rk = key[0], ck = key[1];
      if (typeof rk === 'number' && typeof ck === 'number') {
        const i = rk < 0 ? n + rk : rk;
        const j = ck < 0 ? m + ck : ck;
        return d[i * m + j];
      }
      if (typeof rk === 'number' && ck && ck._slice) {
        const i = rk < 0 ? n + rk : rk;
        const lo = ck.lower != null ? ck.lower : 0;
        const hi = ck.upper != null ? Math.min(ck.upper, m) : m;
        const out = new Float64Array(hi - lo);
        for (let k = 0; k < hi - lo; k++) out[k] = d[i * m + lo + k];
        out.shape = [out.length];
        return out;
      }
      if (rk && rk._slice && typeof ck === 'number') {
        const lo = rk.lower != null ? rk.lower : 0;
        const hi = rk.upper != null ? Math.min(rk.upper, n) : n;
        const j = ck < 0 ? m + ck : ck;
        const out = new Float64Array(hi - lo);
        for (let i = 0; i < hi - lo; i++) out[i] = d[(lo + i) * m + j];
        out.shape = [out.length];
        return out;
      }
      if (rk && rk._slice && ck && ck._slice) {
        const r0 = rk.lower != null ? rk.lower : 0;
        const r1 = rk.upper != null ? Math.min(rk.upper, n) : n;
        const c0 = ck.lower != null ? ck.lower : 0;
        const c1 = ck.upper != null ? Math.min(ck.upper, m) : m;
        const rows = r1 - r0, cols = c1 - c0;
        const out = new Float64Array(rows * cols);
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) out[i * cols + j] = d[(r0 + i) * m + (c0 + j)];
        }
        out.shape = [rows, cols];
        return out;
      }
    }
    // anything else takes the tuple as one key (dict[str, int] on a class, a sequence's TypeError)
    return _withLine(() => pyGetItem(obj, key), node.line);
  }
  const key = await adderEval(node.slice, scope);
  return _withLine(() => pyGetItem(obj, key), node.line);
}

function _applySlice(obj, lower, upper, step) {
  if (obj instanceof AdderRange) return pyRangeSlice(obj, lower, upper, step);
  if (typeof obj === 'string' || Array.isArray(obj) || obj instanceof Uint8Array) {
    const len = obj.length;
    step = step ?? 1;
    if (step === 0) throw new AdderError('ValueError', 'slice step cannot be zero');
    if (step === 1) {
      const l = lower == null ? 0 : lower < 0 ? Math.max(0, len + lower) : Math.min(lower, len);
      const u = upper == null ? len : upper < 0 ? Math.max(0, len + upper) : Math.min(upper, len);
      return typeof obj === 'string' ? obj.slice(l, u) : obj instanceof PyTuple ? mkTuple(obj.slice(l, u)) : obj instanceof PyByteArray ? PyByteArray.from(obj.slice(l, u)) : obj.slice(l, u);
    }
    // general step
    let start, stop;
    if (step > 0) {
      start = lower == null ? 0 : lower < 0 ? Math.max(0, len + lower) : Math.min(lower, len);
      stop = upper == null ? len : upper < 0 ? Math.max(0, len + upper) : Math.min(upper, len);
    } else {
      start = lower == null ? len - 1 : lower < 0 ? Math.max(-1, len + lower) : Math.min(lower, len - 1);
      stop = upper == null ? -1 : upper < 0 ? Math.max(-1, len + upper) : upper;
    }
    const result = [];
    if (step > 0) { for (let i = start; i < stop; i += step) result.push(obj[i]); }
    else { for (let i = start; i > stop; i += step) result.push(obj[i]); }
    return typeof obj === 'string' ? result.join('') : obj instanceof PyTuple ? mkTuple(result) : result;
  }
  throw new AdderError('TypeError', `'${pyTypeName(obj)}' object does not support slicing`);
}

// Compute the index positions a slice covers, in iteration order. Mirrors
// _applySlice's clamping. Returns [] when the slice is empty.
function _sliceIndices(len, lower, upper, step) {
  step = step ?? 1;
  if (step === 0) throw new AdderError('ValueError', 'slice step cannot be zero');
  let start, stop;
  if (step > 0) {
    start = lower == null ? 0 : lower < 0 ? Math.max(0, len + lower) : Math.min(lower, len);
    stop = upper == null ? len : upper < 0 ? Math.max(0, len + upper) : Math.min(upper, len);
  } else {
    start = lower == null ? len - 1 : lower < 0 ? Math.max(-1, len + lower) : Math.min(lower, len - 1);
    stop = upper == null ? -1 : upper < 0 ? Math.max(-1, len + upper) : upper;
  }
  const out = [];
  if (step > 0) { for (let i = start; i < stop; i += step) out.push(i); }
  else { for (let i = start; i > stop; i += step) out.push(i); }
  return out;
}

function _applySliceAssign(obj, lower, upper, step, value, line) {
  if (typeof obj === 'string') {
    throw new AdderError('TypeError', "'str' object does not support item assignment", line);
  }
  if (obj instanceof Uint8Array) {
    throw new AdderError('TypeError', "'bytes' object does not support item assignment", line);
  }
  if (!Array.isArray(obj)) {
    throw new AdderError('TypeError', `'${pyTypeName(obj)}' object does not support slice assignment`, line);
  }
  const rhs = [...pyIter(value)];
  const effectiveStep = step ?? 1;
  if (effectiveStep === 1) {
    // Simple slice — splice handles length changes (shrink / grow / insert).
    const len = obj.length;
    const l = lower == null ? 0 : lower < 0 ? Math.max(0, len + lower) : Math.min(lower, len);
    const u = upper == null ? len : upper < 0 ? Math.max(0, len + upper) : Math.min(upper, len);
    const removeCount = Math.max(0, u - l);
    obj.splice(l, removeCount, ...rhs);
    return;
  }
  // Extended slice — same-length requirement.
  const indices = _sliceIndices(obj.length, lower, upper, step);
  if (rhs.length !== indices.length) {
    throw new AdderError(
      'ValueError',
      `attempt to assign sequence of size ${rhs.length} to extended slice of size ${indices.length}`,
      line,
    );
  }
  for (let k = 0; k < indices.length; k++) obj[indices[k]] = rhs[k];
}

function _applySliceDelete(obj, lower, upper, step, line) {
  if (typeof obj === 'string') {
    throw new AdderError('TypeError', "'str' object doesn't support item deletion", line);
  }
  if (obj instanceof Uint8Array) {
    throw new AdderError('TypeError', "'bytes' object doesn't support item deletion", line);
  }
  if (!Array.isArray(obj)) {
    throw new AdderError('TypeError', `'${pyTypeName(obj)}' object doesn't support slice deletion`, line);
  }
  const effectiveStep = step ?? 1;
  if (effectiveStep === 1) {
    const len = obj.length;
    const l = lower == null ? 0 : lower < 0 ? Math.max(0, len + lower) : Math.min(lower, len);
    const u = upper == null ? len : upper < 0 ? Math.max(0, len + upper) : Math.min(upper, len);
    if (u > l) obj.splice(l, u - l);
    return;
  }
  const indices = _sliceIndices(obj.length, lower, upper, step);
  // Sort descending so each splice doesn't shift the remaining indices.
  indices.sort((a, b) => b - a);
  for (const i of indices) obj.splice(i, 1);
}

// ── function call ──

async function _evalCall(node, scope) {
  const func = await adderEval(node.func, scope);
  const args = [];
  for (const a of node.args) {
    if (a.type === 'Starred') { for (const v of pyIter(await adderEval(a.value, scope))) args.push(v); }
    else args.push(await adderEval(a, scope));
  }
  const kwArgs = [];
  for (const kw of node.keywords) {
    if (kw.name === null) {
      const obj = await adderEval(kw.value, scope);
      if (obj instanceof Map) { for (const [k, v] of obj) kwArgs.push([k, v]); }
      else { for (const k of Object.keys(obj)) kwArgs.push([k, obj[k]]); }
    } else {
      kwArgs.push([kw.name, await adderEval(kw.value, scope)]);
    }
  }
  // special builtins that need caller's scope
  if (func._sentinel === 'super') return _evalSuperCall(args, scope, node.line);
  if (func._sentinel === 'eval') return _evalBuiltinEval(args, scope, node.line);
  if (func._sentinel === 'exec') return _evalBuiltinExec(args, scope, node.line);
  // globals(): the module's namespace itself (writes define names); locals(): a snapshot of
  // the current scope's names
  if (func._sentinel === 'globals') { let s = scope; while (s.parent) s = s.parent; return s.vars; }
  if (func._sentinel === 'locals') { if (!scope.parent) return scope.vars; return new PyDict(scope.vars); }
  return _callValue(func, args, kwArgs, node.line);
}

// ── call stack for tracebacks ──

const _callStack = [];

async function _callValue(func, args, kwArgs, line) {
  if (typeof func !== 'function') {
    if (typeof func === 'object' && func !== null && typeof func.__call__ === 'function') {
      return _callValue(func.__call__.bind(func), args, kwArgs, line);
    }
    throw new AdderError('TypeError', `'${pyTypeName(func)}' object is not callable`, line);
  }
  const name = func._pyName || func.name || '<anonymous>';
  _callStack.push({ name, line });
  try {
    if (kwArgs.length > 0) {
      if (func._pyFunc) {
        return await func(...args, { _kw: true, ...Object.fromEntries(kwArgs) });
      }
      const kw = { _kw: true };
      for (const [k, v] of kwArgs) kw[k] = v;
      try {
        return await func(...args, kw);
      } catch (e) {
        if (e instanceof TypeError && /\bnew\b/.test(e.message)) return new func(...args, kw);
        if (e instanceof AdderError || e instanceof _BreakSignal || e instanceof _ContinueSignal || e instanceof _ReturnSignal) throw e;
        throw new AdderError('RuntimeError', e.message || String(e), line);
      }
    }
    return await func(...args);
  } catch (e) {
    if (e instanceof TypeError && /\bnew\b/.test(e.message)) {
      try { return new func(...args); } catch (e2) {
        if (e2 instanceof AdderError) throw e2;
        throw new AdderError('RuntimeError', e2.message || String(e2), line);
      }
    }
    if (e instanceof AdderError) {
      if (!e._tracebackSet) { e._traceback = _callStack.map(f => ({ ...f })); e._tracebackSet = true; }
      throw e;
    }
    if (e instanceof _BreakSignal || e instanceof _ContinueSignal || e instanceof _ReturnSignal) throw e;
    const ae = new AdderError('RuntimeError', e.message || String(e), line);
    ae._traceback = _callStack.map(f => ({ ...f }));
    ae._tracebackSet = true;
    throw ae;
  } finally {
    _callStack.pop();
  }
}

// ── function creation ──

function _hasYield(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'Yield' || node.type === 'YieldFrom') return true;
  // don't descend into nested function/class defs
  if (node.type === 'FunctionDef' || node.type === 'AsyncFunctionDef' || node.type === 'ClassDef' || node.type === 'Lambda') return false;
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) { for (const item of val) { if (_hasYield(item)) return true; } }
    else if (val && typeof val === 'object' && val.type) { if (_hasYield(val)) return true; }
  }
  return false;
}

// Python evaluates parameter defaults ONCE, when the def / lambda runs — so `lambda i=i:` in a
// loop captures each i, and a mutable default is shared between calls.
async function _evalDefaults(node, scope) {
  const d = {};
  for (const p of [...(node.params || []), ...(node.kwonly || [])]) {
    if (p.default) d[p.name] = await adderEval(p.default, scope);
  }
  return d;
}

// What inspect / __defaults__ read off a `def` or lambda: its parameters as written, with the
// defaults evaluated at definition time. `_pyDef` marks a Python function (type 'function'),
// separately from `_pyFunc` (which also decides self-binding on plain objects).
function _attachSignature(fn, node, defaults, scope = null) {
  const posonly = node.posonly || 0;
  const pos = (node.params || []).map((p, i) => ({ name: p.name, kind: i < posonly ? 'POSITIONAL_ONLY' : 'POSITIONAL_OR_KEYWORD', hasDefault: Object.hasOwn(defaults, p.name) }));
  const kwonly = (node.kwonly || []).map((p) => ({ name: p.name, kind: 'KEYWORD_ONLY', hasDefault: Object.hasOwn(defaults, p.name) }));
  fn._pyDef = true;
  fn._pySig = { params: pos, vararg: node.vararg || null, kwonly, kwarg: node.kwarg || null, defaults, isAsync: node.type === 'AsyncFunctionDef' };
  // where it's defined (its __code__'s co_firstlineno / co_filename)
  let root = scope; while (root && root.parent) root = root.parent;
  fn._pySig.line = node.line || 0;
  fn._pySig.file = root && root.vars.has('__file__') ? root.vars.get('__file__') : '<string>';
  if (root) Object.defineProperty(fn, '_pyGlobals', { value: root.vars, configurable: true });
  const posDefaults = pos.filter((p) => p.hasDefault).map((p) => defaults[p.name]);
  fn.__defaults__ = posDefaults.length ? mkTuple(posDefaults) : null;
  const kwd = kwonly.filter((p) => p.hasDefault);
  fn.__kwdefaults__ = kwd.length ? new LiveDefaults(defaults, kwd.map((p) => [p.name, defaults[p.name]])) : null;
  fn._pyRedirectable = true;   // its defaults are live and its __code__ can be replaced
  Object.defineProperty(fn, '_pyNode', { value: node, configurable: true });
  Object.defineProperty(fn, '_pyScope', { value: scope, configurable: true });
  return fn;
}
// func.__code__ = other.__code__: func now runs other's body, in other's scope, with FUNC's
// defaults — __defaults__ aligned to the new code's trailing positional parameters,
// __kwdefaults__ by name — as CPython runs a replaced code object (networkx's argmap compiles a
// signature without defaults and relies on this). Rebuilt when func's defaults change.
setRedirectBuilder((fn) => {
  const code = fn._pyRedirectCode;
  if (!code) { fn._pyRedirect = null; return; }
  const target = code._pyFn;
  if (!target._pyNode) throw new AdderError('NotImplementedError', `this code object comes from a compiled function ('${target._pyName || target.name}'): run it on the tree-walker`);
  const node = target._pyNode;
  const d = {};
  const params = node.params || [];
  const defs = fn.__defaults__ ? [...fn.__defaults__] : [];
  const first = params.length - defs.length;
  params.forEach((p, i) => { d[p.name] = i >= first ? defs[i - first] : NO_DEFAULT; });
  for (const p of node.kwonly || []) d[p.name] = NO_DEFAULT;
  if (fn.__kwdefaults__) for (const [k, v] of fn.__kwdefaults__) d[k] = v;
  Object.defineProperty(fn, '_pyRedirect', { value: _makeFunction(node, target._pyScope, d), writable: true, configurable: true });
});

function _docstringOf(node) {
  const s = node.body && node.body[0];
  return s && s.type === 'Expr' && s.value && s.value.type === 'Constant' && typeof s.value.value === 'string' ? s.value.value : null;
}

function _makeFunction(node, scope, defaults = {}) {
  const isAsync = node.type === 'AsyncFunctionDef';
  const isGenerator = node.body.some(s => _hasYield(s));

  if (isGenerator) return _makeGeneratorFunction(node, scope, defaults);

  const fn = async function (...callArgs) {
    if (fn._pyRedirect) return fn._pyRedirect.apply(this, callArgs);   // its __code__ was replaced
    const localScope = new AdderScope(scope);
    // bind parameters
    await _bindParams(node, callArgs, localScope, defaults);
    // execute body
    try {
      for (let i = 0; i < node.body.length; i++) {
        const stmt = node.body[i];
        // docstring — skip first string expression
        if (i === 0 && stmt.type === 'Expr' && stmt.value.type === 'Constant' && typeof stmt.value.value === 'string') continue;
        await adderEval(stmt, localScope);
      }
      return null;
    } catch (e) {
      if (e instanceof _ReturnSignal) return e.value;
      throw e;
    }
  };
  fn._pyFunc = true;
  fn._pyName = node.name;
  fn.__doc__ = _docstringOf(node);
  return _attachSignature(fn, node, defaults, scope);
}

// generator.close(): GeneratorExit raised at the paused yield, so its except / finally run (a
// generator that never started, or has finished, just ends); yielding again is a RuntimeError
async function _closeGen(gen, what = 'generator') {
  let r;
  try {
    r = await gen.throw(new AdderError('GeneratorExit', '', undefined, []));
  } catch (e) {
    if (e && (e.pyType === 'GeneratorExit' || e.pyType === 'StopIteration' || e.pyType === 'StopAsyncIteration')) return null;
    throw e;
  }
  if (!r.done) throw new AdderError('RuntimeError', `${what} ignored GeneratorExit`);
  return r.value === undefined ? null : r.value;   // it returned a value on GeneratorExit (3.13)
}

function _makeGeneratorFunction(node, scope, defaults = {}) {
  // Generator functions use a _YieldSignal to communicate yield values
  // back to the async-generator wrapper.
  const fn = function (...callArgs) {
    if (fn._pyRedirect) return fn._pyRedirect.apply(this, callArgs);   // its __code__ was replaced
    // Return an object that implements both sync and async iteration.
    // We use an async generator internally, exposed via Symbol.asyncIterator.
    // For sync consumers (for..of), we also provide Symbol.iterator
    // that collects eagerly — but the primary path is for-await.
    // ONE underlying generator per call, as in Python: next(g) then list(g) continues
    // where next left off (each for-await used to restart the body)
    let gen = null;
    const isAsyncGen = node.type === 'AsyncFunctionDef';
    const run = () => gen || (gen = _runGenerator(node, scope, callArgs, defaults, isAsyncGen));
    // resuming a generator while it runs is an error (CPython's ValueError) — the async
    // generator underneath would quietly queue the call and wait on itself forever
    let running = false, finished = false;
    const step = (f) => {
      if (running) return Promise.reject(new AdderError('ValueError', 'generator already executing'));
      running = true;
      let p;
      try { p = f(); } catch (e) { running = false; finished = true; throw e; }
      return Promise.resolve(p).then((r) => { running = false; if (r && r.done) finished = true; return r; }, (e) => { running = false; finished = true; throw e; });
    };
    // (loops and yield from step it through these too, so they see the guard)
    const jsIter = {
      next: (v) => step(() => run().next(v)),
      throw: (e) => step(() => run().throw(e)),
      return: (v) => (gen ? gen.return(v) : Promise.resolve({ done: true, value: v })),
      [Symbol.asyncIterator]() { return jsIter; },
    };
    // an `async def` with a yield: an async generator — __anext__ / asend / athrow / aclose, each an
    // awaitable (a Promise here); not iterable, `async for` reads it
    if (isAsyncGen) {
      const step = (r) => r.then((x) => { if (x.done) throw new AdderError('StopAsyncIteration', '', undefined, []); return x.value; });
      const agen = {
        __adderClass__: 'async_generator',
        _genName: node.name,
        _pyAsyncGen: true,
        get ag_running() { return running; },
        get ag_frame() { return finished ? null : { __adderClass__: 'frame', f_lineno: node.line || 0, f_locals: new PyDict(), f_code: { co_name: node.name } }; },
        ag_await: null,
        __aiter__() { return agen; },
        __anext__() { return step(jsIter.next(null)); },
        asend(v) {
          if (!gen && v !== null && v !== undefined) return Promise.reject(new AdderError('TypeError', "can't send non-None value to a just-started async generator"));
          return step(jsIter.next(v));
        },
        athrow(t, v) {
          let exc = v ?? t;
          if (typeof exc === 'function' && exc._pyClass) exc = exc();
          return Promise.resolve(exc).then((x) => step(jsIter.throw(excToThrowable(x))));
        },
        aclose() { const done = (v) => { finished = true; return null; }; return gen ? _closeGen(gen, 'async generator').then(done) : Promise.resolve(done(null)); },
      };
      return agen;
    }
    const genObj = {
      __adderClass__: 'generator',
      _genName: node.name,
      get gi_running() { return running; },
      // (a frame while it can still run — not started, suspended or running — None once finished)
      get gi_frame() { return finished ? null : { __adderClass__: 'frame', f_lineno: node.line || 0, f_locals: new PyDict(), f_code: { co_name: node.name } }; },
      [Symbol.asyncIterator]() { return jsIter; },
      next(v) { return jsIter.next(v); },
      send(v) {
        // a generator that hasn't started takes only None (CPython's rule)
        if (!gen && v !== null && v !== undefined) return Promise.reject(new AdderError('TypeError', "can't send non-None value to a just-started generator"));
        return jsIter.next(v).then((r) => { if (r.done) throw stopIteration(r.value); return r.value; });
      },
      close() { const done = (v) => { finished = true; return v; }; return gen ? _closeGen(gen).then(done) : Promise.resolve(done(null)); },
      // g.throw(exc): raise exc at the paused yield; the next value it yields, or StopIteration
      throw(t, v) {
        let exc = v ?? t;
        if (typeof exc === 'function' && exc._pyClass) exc = exc();
        return Promise.resolve(exc).then((x) => jsIter.throw(excToThrowable(x))).then((r) => {
          if (r.done) throw stopIteration(r.value);
          return r.value;
        });
      },
      _jsThrow(err) { return jsIter.throw(err); },   // the JS protocol ({value, done}), for contextlib
      _asyncGen: true,   // (async-only: helpers that can wait collect it instead of iterating it now)
      // sync iteration needs the values now; generators here are async (for await / list())
      [Symbol.iterator]() {
        throw new AdderError('TypeError', 'Use "for await" or list() with generators');
      },
    };
    return genObj;
  };
  fn._pyFunc = true;
  fn._pyName = node.name;
  fn._isGenerator = true;
  fn.__doc__ = _docstringOf(node);
  return _attachSignature(fn, node, defaults, scope);
}

async function* _runGenerator(node, scope, callArgs, defaults = {}, isAsyncGen = false) {
  const localScope = new AdderScope(scope);
  await _bindParams(node, callArgs, localScope, defaults);
  try {
    for (let i = 0; i < node.body.length; i++) {
      const stmt = node.body[i];
      if (i === 0 && stmt.type === 'Expr' && stmt.value.type === 'Constant' && typeof stmt.value.value === 'string') continue;
      yield* await _evalGenStmt(stmt, localScope);
    }
  } catch (e) {
    if (e instanceof _ReturnSignal) return e.value;   // `return x`: StopIteration(x).value, yield from's result
    // PEP 479: StopIteration raised in a generator's body is a RuntimeError (from it); an async
    // generator's StopAsyncIteration too
    if (e && (e.pyType === 'StopIteration' || (isAsyncGen && e.pyType === 'StopAsyncIteration'))) {
      const err = new AdderError('RuntimeError', `${isAsyncGen ? 'async generator' : 'generator'} raised ${e.pyType}`);
      err.__cause__ = excValue(e); err.__context__ = excValue(e);
      throw err;
    }
    throw e;
  }
  return null;
}

// a generator's except-handler body: `raised` is the active exception while the body runs, and
// not while the generator is suspended at a yield in it (CPython swaps a generator's exception
// state in and out as it resumes) — an abandoned generator leaves nothing on the stack
async function* _inExcContext(inner, raised) {
  let method = 'next', arg;
  for (;;) {
    let r;
    _excStack.push(raised);
    try { r = await inner[method](arg); } finally { const i = _excStack.lastIndexOf(raised); if (i >= 0) _excStack.splice(i, 1); }
    if (r.done) return r.value;
    try { arg = yield r.value; method = 'next'; } catch (e) { method = 'throw'; arg = e; }
  }
}
// yield from EXPR, as PEP 380 spells it, through the iterator's Python methods — any iterator,
// not only generators: next() while None is sent, its send() otherwise; a thrown exception goes
// to its throw() if it has one; GeneratorExit closes it (its close(), if any) and propagates; the
// result is its StopIteration's value
const _stopValue = (e) => (e.value !== undefined ? e.value : e.args && e.args.length ? e.args[0] : null);
async function* _yieldFrom(iterable) {
  const B = adderModules.builtins;
  const it = await B.iter(iterable);
  const method = (name) => { try { return adderGetAttr(it, name); } catch (e) { if (e && e.pyType === 'AttributeError') return null; throw e; } };
  let y;
  try { y = await B.next(it); } catch (e) { if (e && e.pyType === 'StopIteration') return _stopValue(e); throw e; }
  for (;;) {
    let sent, thrown = null;
    try { sent = yield y; } catch (e) { thrown = e; }
    try {
      if (thrown !== null) {
        if (thrown && (thrown.pyType === 'GeneratorExit' || excValue(thrown) && excValue(thrown).pyType === 'GeneratorExit')) {
          const close = method('close');
          if (typeof close === 'function') await close();
          throw thrown;
        }
        const th = method('throw');
        if (typeof th !== 'function') throw thrown;
        y = await th(excValue(thrown));
      } else if (sent === null || sent === undefined) y = await B.next(it);
      else {
        const send = method('send');
        if (typeof send !== 'function') throw new AdderError('AttributeError', `'${pyTypeName(it)}' object has no attribute 'send'`);
        y = await send(sent);
      }
    } catch (e) {
      if (e && e.pyType === 'StopIteration' && e !== thrown) return _stopValue(e);
      throw e;
    }
  }
}
async function* _evalGenStmt(node, scope) {
  // Like adderEval but yields instead of throwing for Yield nodes
  switch (node.type) {
    case 'Expr':
      if (node.value.type === 'Yield') {
        yield node.value.value ? await adderEval(node.value.value, scope) : null;
        return;
      }
      if (node.value.type === 'YieldFrom') {
        yield* _yieldFrom(await adderEval(node.value.value, scope));
        return;
      }
      await adderEval(node, scope);
      return;
    // `v = yield x` / `v = yield from g` / `v += yield x`: the value sent in (or the subgenerator's
    // return value) is what's assigned — the parser hoists every other placement of a yield
    case 'Assign': case 'AugAssign': case 'AnnAssign': {
      const y = node.value;
      if (!y || (y.type !== 'Yield' && y.type !== 'YieldFrom')) { await adderEval(node, scope); return; }
      const got = y.type === 'Yield'
        ? yield (y.value ? await adderEval(y.value, scope) : null)
        : yield* _yieldFrom(await adderEval(y.value, scope));
      const sent = got === undefined ? null : got;
      if (node.type === 'Assign') { for (const t of node.targets) await _assignTarget(t, sent, scope); return; }
      if (node.type === 'AnnAssign') { await _assignTarget(node.target, sent, scope); return; }
      const cur = await adderEval(node.target, scope);
      await _assignTarget(node.target, await _binOp(node.op, cur, sent, node.line), scope);
      return;
    }
    case 'For': {
      const iterable = await adderEval(node.iter, scope);
      let broke = false;
      const iter = isUserIterable(iterable) ? pyIterAsync(iterable) : iterable[Symbol.asyncIterator] ? iterable : pyIter(iterable);
      for await (const value of iter) {
        await _assignTarget(node.target, value, scope);
        try {
          for (const stmt of node.body) yield* await _evalGenStmt(stmt, scope);
        } catch (e) {
          if (e instanceof _BreakSignal) { broke = true; break; }
          if (e instanceof _ContinueSignal) continue;
          throw e;
        }
      }
      if (!broke) for (const stmt of node.orelse) yield* await _evalGenStmt(stmt, scope);
      return;
    }
    case 'While': {
      let broke = false, iterations = 0;
      while (await pyBoolMaybe(await adderEval(node.test, scope))) {
        if (++iterations > 1000000) throw new AdderError('RuntimeError', 'maximum loop iterations exceeded');
        try {
          for (const stmt of node.body) yield* await _evalGenStmt(stmt, scope);
        } catch (e) {
          if (e instanceof _BreakSignal) { broke = true; break; }
          if (e instanceof _ContinueSignal) continue;
          throw e;
        }
      }
      if (!broke) for (const stmt of node.orelse) yield* await _evalGenStmt(stmt, scope);
      return;
    }
    case 'If': {
      const test = await adderEval(node.test, scope);
      const branch = await pyBoolMaybe(test) ? node.body : node.orelse;
      for (const stmt of branch) yield* await _evalGenStmt(stmt, scope);
      return;
    }
    case 'Match': {
      const c = await _matchCase(node, scope);
      if (c) for (const stmt of c.body) yield* await _evalGenStmt(stmt, scope);
      return;
    }
    // the same shape as _evalTry, with yields allowed anywhere: else runs when nothing was raised,
    // a handler's exception is the active one (a bare `raise` in it — `except GeneratorExit:
    // raise`), and finally runs on every way out, a handler that raises included
    case 'Try': {
      try {
        let raised = null;
        try {
          for (const stmt of node.body) yield* await _evalGenStmt(stmt, scope);
        } catch (e) {
          if (e instanceof _BreakSignal || e instanceof _ContinueSignal || e instanceof _ReturnSignal) throw e;
          raised = e;
        }
        if (raised === null) {
          for (const stmt of node.orelse || []) yield* await _evalGenStmt(stmt, scope);
          return;
        }
        for (const handler of node.handlers) {
          const excTypeVal = handler.excType ? await adderEval(handler.excType, scope) : null;
          if (!excMatches(raised, excTypeVal)) continue;
          if (handler.name) scope.set(handler.name, excValue(raised));
          for (const stmt of handler.body) yield* _inExcContext(_evalGenStmt(stmt, scope), raised);
          return;
        }
        throw raised;
      } finally {
        for (const stmt of node.finalbody) yield* await _evalGenStmt(stmt, scope);
      }
    }
    // with … : yield inside (a @contextmanager method's `with self as rv: yield rv`)
    case 'With': {
      if (!_hasYield({ type: 'Block', body: node.body })) { await adderEval(node, scope); return; }
      const managers = [];
      for (const item of node.items) {
        const mgr = await adderEval(item.contextExpr, scope);
        const enter = mgr.__enter__ || mgr.enter;
        const exit = mgr.__exit__ || mgr.exit;
        if (typeof enter !== 'function' || typeof exit !== 'function') {
          throw new AdderError('AttributeError', `'${pyTypeName(mgr)}' does not support the context manager protocol`);
        }
        const value = await enter.call(mgr);
        if (item.optionalVar) await _assignTarget(item.optionalVar, value, scope);
        managers.push({ mgr, exit });
      }
      try {
        for (const stmt of node.body) yield* await _evalGenStmt(stmt, scope);
      } catch (e) {
        if (e instanceof _BreakSignal || e instanceof _ContinueSignal || e instanceof _ReturnSignal) {
          for (const { mgr, exit } of managers.reverse()) await exit.call(mgr, null, null, null);
          throw e;
        }
        for (const { mgr, exit } of managers.reverse()) {
          const suppress = await exit.call(mgr, excTypeOf(e), excValue(e), null);
          if (!suppress) throw e;
        }
        return;
      }
      for (const { mgr, exit } of managers.reverse()) await exit.call(mgr, null, null, null);
      return;
    }
    default:
      // non-yielding statements — just eval normally
      await adderEval(node, scope);
  }
}

async function _bindParams(node, callArgs, localScope, defaults = {}) {
  const { params, vararg, kwarg } = node;
  const kwonly = node.kwonly || [];
  const fname = node.name || '<lambda>';
  let positionalIdx = 0;
  let kwObj = null;
  // zero-argument super() uses the method's FIRST argument, whatever it is called (self, cls, mcs)
  localScope._firstParam = params.length ? params[0].name : (vararg || null);

  // check if last arg is keyword bag
  if (callArgs.length > 0 && callArgs[callArgs.length - 1]?._kw) {
    kwObj = callArgs.pop();
  }
  // (more positionals than params is not refused: JS calls Python callbacks with extras)
  if (kwObj) {
    const names = new PySet([...params.map(p => p.name), ...kwonly.map(p => p.name)]);
    for (const k of Object.keys(kwObj)) {
      if (k === '_kw') continue;
      const i = params.findIndex(p => p.name === k);
      if (i >= 0 && i < callArgs.length) throw new AdderError('TypeError', `${fname}() got multiple values for argument '${k}'`);
      if (!names.has(k) && !kwarg) throw new AdderError('TypeError', `${fname}() got an unexpected keyword argument '${k}'`);
    }
  }

  // bind positional params
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (positionalIdx < callArgs.length) {
      localScope.set(p.name, callArgs[positionalIdx++]);
    } else if (kwObj && Object.hasOwn(kwObj, p.name)) {
      localScope.set(p.name, kwObj[p.name]);
    } else if (Object.hasOwn(defaults, p.name) ? defaults[p.name] !== NO_DEFAULT : p.default) {
      localScope.set(p.name, Object.hasOwn(defaults, p.name) ? defaults[p.name] : await adderEval(p.default, localScope));
    } else {
      throw new AdderError('TypeError', `${fname}() missing 1 required positional argument: '${p.name}'`);
    }
  }

  // vararg
  if (vararg) {
    localScope.set(vararg, mkTuple(callArgs.slice(positionalIdx)));
    positionalIdx = callArgs.length;
  }

  // keyword-only params
  for (const p of kwonly) {
    if (kwObj && Object.hasOwn(kwObj, p.name)) {
      localScope.set(p.name, kwObj[p.name]);
    } else if (Object.hasOwn(defaults, p.name) ? defaults[p.name] !== NO_DEFAULT : p.default) {
      localScope.set(p.name, Object.hasOwn(defaults, p.name) ? defaults[p.name] : await adderEval(p.default, localScope));
    } else {
      throw new AdderError('TypeError', `${fname}() missing 1 required keyword-only argument: '${p.name}'`);
    }
  }

  // **kwargs
  if (kwarg) {
    const extra = {};
    if (kwObj) {
      const usedNames = new PySet([...params.map(p => p.name), ...kwonly.map(p => p.name), '_kw']);
      for (const k of Object.keys(kwObj)) {
        if (!usedNames.has(k)) extra[k] = kwObj[k];
      }
    }
    localScope.set(kwarg, extra);
  }
}

function _makeLambda(node, scope, defaults = {}) {
  const fn = async function (...callArgs) {
    const localScope = new AdderScope(scope);
    await _bindParams(node, callArgs, localScope, defaults);
    return adderEval(node.body, localScope);
  };
  fn._pyFunc = true;
  fn._pyName = '<lambda>';
  return _attachSignature(fn, node, defaults, scope);
}

// ── class ──

// ── C3 linearization (MRO) ──

async function _evalClass(node, scope) {
  const bases = [];
  for (const b of node.bases) {
    if (b.type === 'Starred') bases.push(...await pyCollect(await adderEval(b.value, scope)));
    else bases.push(await adderEval(b, scope));
  }
  // class keywords: metaclass=, and the rest for __init_subclass__
  let kw = null;
  for (const k of node.keywords || []) {
    kw = kw || {};
    const v = await adderEval(k.value, scope);
    if (k.arg === null) { for (const [kk, vv] of (v instanceof Map ? v : Object.entries(v))) kw[kk] = vv; }
    else kw[k.arg] = v;
  }

  // evaluate class body in a class scope; as in CPython it starts with __module__ (the defining
  // module's __name__) and __qualname__
  const classScope = new AdderScope(scope);
  classScope._isClass = true;
  // its methods' `__class__` (what zero-argument super() reads): a cell the class factory fills
  classScope._classCell = new PyCell();
  let root = scope; while (root.parent) root = root.parent;
  classScope.set('__module__', root.vars.has('__name__') ? root.vars.get('__name__') : '__main__');
  classScope.set('__qualname__', node.name);
  for (const stmt of node.body) await adderEval(stmt, classScope);

  // build class (the factory both engines share). A method that names `__class__` or `super`
  // gets the cell into the namespace (__classcell__), and type.__new__ fills it — before
  // __init_subclass__ fires, so super() works in a hook that calls a method; otherwise (an exec'd
  // super()) it's filled here, after
  const classVars = Object.fromEntries(classScope.vars);
  const needsCell = classNeedsCell(node);
  if (needsCell) classVars.__classcell__ = classScope._classCell;
  const cls = await classStatement(node.name, bases, classVars, classAnnotations(node.body), kw);
  if (!needsCell && cls && cls._pyClass && classScope._classCell._v === undefined) classScope._classCell._v = cls;

  // handle decorators
  let result = cls;
  for (let i = node.decorators.length - 1; i >= 0; i--) {
    const dec = await adderEval(node.decorators[i], scope);
    result = await _callValue(dec, [result], [], node.line);
  }

  scope.set(node.name, result);
  return null;
}

// ── for loop ──

async function _evalFor(node, scope) {
  const iterable = await adderEval(node.iter, scope);
  let broke = false;
  // for-await handles both sync iterables and async generators; `async for`, the async protocol
  // (__aiter__ / __anext__)
  const iter = node.isAsync ? pyAIter(iterable) : isUserIterable(iterable) ? pyIterAsync(iterable) : iterable && iterable[Symbol.asyncIterator] ? iterable : pyIter(iterable);
  // stepped by hand, not for-await, which closes the iterator on any early exit. Python's
  // reference counting decides that instead: an iterator something still refers to stays open
  // (`for x in it: break` then `list(it)` goes on where the loop stopped); a temporary one — the
  // loop's `for x in gen():` — is finalized as the loop lets go of it (its `finally` runs).
  const it = iter[Symbol.asyncIterator] ? iter[Symbol.asyncIterator]() : iter[Symbol.iterator]();
  const owned = !(node.iter.type === 'Name' || node.iter.type === 'Attribute' || node.iter.type === 'Subscript');
  const release = async () => {
    if (!owned) return;
    if (node.isAsync) return;   // (CPython doesn't aclose an async iterator a loop leaves)
    if (iterable && iterable.__adderClass__ === 'generator' && typeof iterable.close === 'function') await iterable.close();
    else if (typeof it.return === 'function') await it.return(undefined);
  };
  let _loopCount = 0;
  for (;;) {
    const step = await it.next();
    if (step.done) break;
    const value = step.value;
    // yield to event loop periodically to prevent page lockup
    if (++_loopCount % 1000 === 0) await new Promise(r => setTimeout(r, 0));
    try {
      await _assignTarget(node.target, value, scope);
      for (const stmt of node.body) await adderEval(stmt, scope);
    } catch (e) {
      if (e instanceof _BreakSignal) { broke = true; await release(); break; }
      if (e instanceof _ContinueSignal) continue;
      await release();
      throw e;
    }
  }
  if (!broke) {
    for (const stmt of node.orelse) await adderEval(stmt, scope);
  }
  return null;
}

// ── while loop ──

async function _evalWhile(node, scope) {
  let broke = false;
  let iterations = 0;
  const limit = scope.has('__loop_limit__') ? scope.get('__loop_limit__') : 1000000;
  while (await pyBoolMaybe(await adderEval(node.test, scope))) {
    if (limit > 0 && ++iterations > limit) throw new AdderError('RuntimeError', `maximum loop iterations exceeded (${limit})`);
    if (iterations % 1000 === 0) await new Promise(r => setTimeout(r, 0));
    try {
      for (const stmt of node.body) await adderEval(stmt, scope);
    } catch (e) {
      if (e instanceof _BreakSignal) { broke = true; break; }
      if (e instanceof _ContinueSignal) continue;
      throw e;
    }
  }
  if (!broke) {
    for (const stmt of node.orelse) await adderEval(stmt, scope);
  }
  return null;
}

// ── with statement ──

// `with a, b: body` is `with a: with b: body` (PEP 343): each manager's exit sees what the inner
// ones let through — an exception one suppressed is gone for the rest. The exit runs on every way
// out: falling off the end, an exception, return / break / continue.
function _evalWith(node, scope) { return _withFrom(node, scope, 0); }
async function _withFrom(node, scope, i) {
  if (i === node.items.length) { for (const stmt of node.body) await adderEval(stmt, scope); return null; }
  const item = node.items[i];
  const mgr = await adderEval(item.contextExpr, scope);
  const isAsync = !!node.isAsync;
  const value = await ctxEnter(mgr, isAsync)();
  let clean = true;
  try {
    if (item.optionalVar) await _assignTarget(item.optionalVar, value, scope);
    await _withFrom(node, scope, i + 1);
  } catch (e) {
    if (e instanceof _BreakSignal || e instanceof _ContinueSignal || e instanceof _ReturnSignal) throw e;
    clean = false;
    if (!await pyBoolMaybe(await ctxExit(mgr, e, isAsync))) throw e;
  } finally {
    if (clean) await ctxExit(mgr, null, isAsync);
  }
  return null;
}

// ── try/except ──

// match: the first case whose pattern fits (its captures bound) and whose guard holds, or null
async function _matchCase(node, scope) {
  const subject = await adderEval(node.subject, scope);
  for (const c of node.cases) {
    if (!c._desc) { c._valueNodes = []; c._desc = compileMatchPattern(c.pattern, c._valueNodes); }
    const values = [];
    for (const v of c._valueNodes) values.push(await adderEval(v, scope));
    const binds = new Map();
    if (!(await pyMatch(subject, c._desc, values, binds))) continue;
    for (const [k, v] of binds) scope.set(k, v);
    if (c.guard && !await pyBoolMaybe(await adderEval(c.guard, scope))) continue;
    return c;
  }
  return null;
}

async function _evalTry(node, scope) {
  try {
    let raised = null;
    try {
      for (const stmt of node.body) await adderEval(stmt, scope);
    } catch (e) {
      if (e instanceof _BreakSignal || e instanceof _ContinueSignal || e instanceof _ReturnSignal) throw e;
      raised = e;
    }
    if (raised === null) {
      for (const stmt of node.orelse) await adderEval(stmt, scope);
      return null;
    }
    for (const handler of node.handlers) {
      const excTypeVal = handler.excType ? await adderEval(handler.excType, scope) : null;
      if (!excMatches(raised, excTypeVal)) continue;
      if (handler.name) scope.set(handler.name, excValue(raised));
      _excStack.push(raised);
      try {
        for (const stmt of handler.body) await adderEval(stmt, scope);
      } finally {
        _excStack.pop();
      }
      return null;
    }
    throw raised;
  } finally {
    for (const stmt of node.finalbody) await adderEval(stmt, scope);
  }
}

function _matchException(error, excTypeVal) {
  return excMatches(error, excTypeVal);
}
// ── super() / eval() / exec() builtins ──

function _evalSuperCall(args, scope, line) {
  if (args.length) return pySuper(...args);
  // the nearest enclosing function's first argument (CPython: the first local of the frame)
  let s = scope;
  while (s && s._firstParam === undefined) s = s.parent;
  const first = s && s._firstParam;
  if (!first) throw new AdderError('RuntimeError', 'super(): no arguments', line);
  if (!s.vars.has(first)) throw new AdderError('RuntimeError', 'super(): arg[0] deleted', line);
  let self = s.vars.get(first);
  if (Array.isArray(self) && first === (s._varargName || null)) self = self[0];
  if (self === undefined) throw new AdderError('RuntimeError', 'super(): no arguments', line);
  // its `__class__`: the cell of the class the function is defined in
  const c = scope._classCellOf();
  if (!c) throw new AdderError('RuntimeError', 'super(): __class__ cell not found', line);
  if (c.cell && c.cell._v === undefined) throw new AdderError('RuntimeError', 'super(): empty __class__ cell', line);
  const cls = c.get();
  if (!(typeof cls === 'function' && cls._pyClass)) throw new AdderError('RuntimeError', `super(): __class__ is not a type (${pyTypeName(cls)})`, line);
  return pySuper(cls, self);
}

async function _evalBuiltinEval(args, scope, line) {
  const code = _sourceOf(args[0]).trim();
  const target = _execScope(args, scope);
  try {
    const exprAst = _adderParseExpr(code);
    return await adderEval(exprAst, target);
  } catch (e) {
    if (e instanceof AdderError) throw e;
    throw new AdderError('SyntaxError', e.message || String(e), line);
  }
}

async function _evalBuiltinExec(args, scope, line) {
  const code = _sourceOf(args[0]);
  const target = _execScope(args, scope);
  try {
    const ast = adderParse(code);
    await adderEval(ast, target);
  } catch (e) {
    if (e instanceof AdderError) throw e;
    throw new AdderError('SyntaxError', e.message || String(e), line);
  }
  return null;
}
// exec / eval called as a plain function (compiled code has no caller scope to hand over): only
// with the namespaces given
const _runningModules = [];
setScopeExec((kind, args) => {
  const kw = args.length && args[args.length - 1] && args[args.length - 1]._kw ? args[args.length - 1] : {};
  const g = args.length > 1 && !(args[1] && args[1]._kw) ? args[1] : kw.globals;
  if ((g === undefined || g === null) && _runningModules.length && args.length === 1) {
    const ns = _runningModules[_runningModules.length - 1];
    return kind === 'exec' ? _evalBuiltinExec([args[0], ns], null) : _evalBuiltinEval([args[0], ns], null);
  }
  if (g === undefined || g === null) {
    throw new AdderError('RuntimeError', `${kind}() without a globals dict needs the caller's scope: run this code on the tree-walker`);
  }
  if (kind === 'exec' && _moduleCompiler && _runOpts.moduleEngine !== 'tree') {
    const r = _execCompiled(args);
    if (r) return r;
  }
  return kind === 'exec' ? _evalBuiltinExec(args, null) : _evalBuiltinEval(args, null);
});
// exec(code, globals[, locals]) from compiled code runs compiled too — the program and what it
// generates on one engine (dataclasses / namedtuple-style code generation: the __init__ / __repr__
// it builds are then compiled functions, synchronous where they can be, not tree-walked coroutines
// handed to code that doesn't wait). The namespaces stay live: the compiled body reads its free
// names from them (then builtins) and its top-level bindings land in them. Code AIR can't lower
// returns null: the tree-walker runs it, as before.
function _execCompiled(args) {
  let ast, code;
  try { code = _sourceOf(args[0]); ast = adderParse(code); } catch { return null; }
  const target = _execScope(args, null);
  let compiled = null;
  let modName = '__main__';
  for (let s = target; s; s = s.parent) if (s.vars && s.vars.has('__name__')) { modName = s.vars.get('__name__'); break; }
  try { compiled = _moduleCompiler(ast, code, { name: typeof modName === 'string' ? modName : '__main__', package: '' }); } catch { compiled = null; }
  if (!compiled) return null;
  const vars = target.vars;
  const builtins = adderModules.builtins;
  const lookup = (n) => {
    for (let s = target; s; s = s.parent) if (s.vars && s.vars.has(n)) return s.vars.get(n);
    return builtins && n in builtins ? builtins[n] : undefined;
  };
  // the module object compiled code mirrors its bindings onto: the namespace itself
  const mod = new Proxy({}, {
    get: (_, k) => (typeof k === 'string' && vars.has(k) ? vars.get(k) : undefined),
    set: (_, k, v) => { vars.set(k, v); return true; },
    has: (_, k) => typeof k === 'string' && vars.has(k),
    deleteProperty: (_, k) => { vars.delete(k); return true; },
    ownKeys: () => [...vars.keys()].filter((k) => typeof k === 'string'),
    getOwnPropertyDescriptor: (_, k) => (typeof k === 'string' && vars.has(k) ? { value: vars.get(k), writable: true, enumerable: true, configurable: true } : undefined),
  });
  const finish = (scope) => {
    if (scope && typeof scope === 'object') {
      for (const k of Object.keys(scope)) if (k !== '__lastExpr__') vars.set(k.endsWith('$') ? k.slice(0, -1) : k, scope[k]);
    }
    return null;
  };
  const r = compiled.run(lookup, mod);
  return r && typeof r.then === 'function' ? r.then(finish) : Promise.resolve(finish(r));
}
// exec / eval's source: a string, bytes, or a code object from compile()
function _sourceOf(x) {
  if (x !== null && typeof x === 'object' && typeof x._pySource === 'string') return x._pySource;
  if (x instanceof Uint8Array) return new TextDecoder().decode(x);
  return String(x);
}
// exec(code, globals, locals) / eval(...): with a globals dict the code runs in a scope whose
// variables ARE that dict (what it defines lands there), builtins behind it; with locals as well,
// those are an inner scope. Without them, the caller's scope.
function _dictVars(d) {
  if (d instanceof Map) return d;
  if (d !== null && typeof d === 'object') return new AttrDict(d);
  throw new AdderError('TypeError', `globals must be a dict, not ${pyTypeName(d)}`);
}
function _execScope(args, scope) {
  const kw = args.length && args[args.length - 1] && args[args.length - 1]._kw ? args[args.length - 1] : {};
  const g = args.length > 1 && !(args[1] && args[1]._kw) ? args[1] : kw.globals;
  const l = args.length > 2 && !(args[2] && args[2]._kw) ? args[2] : kw.locals;
  if (g === undefined || g === null) {
    if (l === undefined || l === null) return scope;
    const s = new AdderScope(scope); s.vars = _dictVars(l); return s;
  }
  const root = new AdderScope(null);
  root.vars = _dictVars(g);
  root._builtins = adderModules.builtins;
  if (!root.vars.has('__builtins__')) root.vars.set('__builtins__', adderModules.builtins);
  if (l === undefined || l === null || l === g) return root;
  const s = new AdderScope(root); s.vars = _dictVars(l); return s;
}

// ── comprehensions ──

function _evalGenExpr(node, scope) {
  // A generator object, as Python's: lazy, iterates once, and an iterator itself (next() works).
  // The body runs on first use; its outermost iterable is evaluated then too.
  let gen = null;
  const run = () => {
    if (!gen) { const genScope = new AdderScope(scope); genScope._isComp = true; gen = _genExprIter(node, genScope, 0); }
    return gen;
  };
  return {
    __adderClass__: 'generator',
    [Symbol.asyncIterator]() { return run(); },
    next(v) { return run().next(v); },
    close() { return gen ? _closeGen(gen) : Promise.resolve(null); },
    _jsThrow(err) { return run().throw(err); },
  };
}

async function* _genExprIter(node, scope, genIdx) {
  const gen = node.generators[genIdx];
  const iterable = await adderEval(gen.iter, scope);
  const iter = isUserIterable(iterable) ? pyIterAsync(iterable) : iterable[Symbol.asyncIterator] ? iterable : pyIter(iterable);
  for await (const value of iter) {
    await _assignTarget(gen.target, value, scope);
    let pass = true;
    for (const ifNode of gen.ifs) {
      if (!await pyBoolMaybe(await adderEval(ifNode, scope))) { pass = false; break; }
    }
    if (!pass) continue;
    if (genIdx + 1 < node.generators.length) {
      yield* _genExprIter(node, scope, genIdx + 1);
    } else {
      yield await adderEval(node.elt, scope);
    }
  }
}

async function _evalComp(node, scope, kind) {
  // a dict comprehension builds a dict (a Map, like a dict literal), not a JS object
  const result = kind === 'list' ? [] : kind === 'set' ? new PySet() : new PyDict();
  const compScope = new AdderScope(scope);
  compScope._isComp = true;   // a walrus inside binds past it (see NamedExpr)
  await _evalCompIter(node, compScope, result, kind, 0);
  return result;
}

async function _evalCompIter(node, scope, result, kind, genIdx) {
  const gen = node.generators[genIdx];
  const iterable = await adderEval(gen.iter, scope);
  // the same iteration as a for loop: user iterables and async ones (generators, itertools); an
  // `async for` clause by the async protocol
  const iter = gen.isAsync ? pyAIter(iterable) : isUserIterable(iterable) ? pyIterAsync(iterable) : iterable && iterable[Symbol.asyncIterator] ? iterable : pyIter(iterable);
  for await (const value of iter) {
    await _assignTarget(gen.target, value, scope);
    // check if filters
    let pass = true;
    for (const ifNode of gen.ifs) {
      if (!await pyBoolMaybe(await adderEval(ifNode, scope))) { pass = false; break; }
    }
    if (!pass) continue;
    if (genIdx + 1 < node.generators.length) {
      await _evalCompIter(node, scope, result, kind, genIdx + 1);
    } else {
      if (kind === 'list') {
        result.push(await adderEval(node.elt, scope));
      } else if (kind === 'set') {
        result.add(await adderEval(node.elt, scope));
      } else {
        const k = await adderEval(node.key, scope);
        const v = await adderEval(node.value, scope);
        result.set(k, v);
      }
    }
  }
}

// ── imports ──

export function _resolveModule(name) {
  if (_registered.has(name)) return _registered.get(name);
  if (_registered.size) { const m = _walkDotted((r) => _registered.get(r), name); if (m) return m; }
  if (name === 'js' && _runOpts.host === false) return null;   // host access off: `import js` is simply not found
  if (adderModules[name]) return adderModules[name];
  if (typeof window !== 'undefined') {
    if (window._auditableExtensions?.[name]) return window._auditableExtensions[name];
    // Walk dotted path through namespace objects so `from learn.tree
    // import X` resolves via `_auditableExtensions['learn'].tree`. Lets
    // extensions following the sklearn-shaped namespace-object pattern
    // (learn, scitra, sadpan, …) expose submodules without registering
    // each one separately.
    const dot = name.indexOf('.');
    if (dot !== -1) {
      const root = name.slice(0, dot);
      const rest = name.slice(dot + 1).split('.');
      let mod = window._auditableExtensions?.[root];
      for (const part of rest) {
        if (mod == null || typeof mod !== 'object') return null;
        mod = mod[part];
      }
      if (mod && typeof mod === 'object') return mod;
    }
  }
  return null;
}

// Bridge to auditable's installed-extension loader. auditable sets a window hook
// (_auditableResolveModule, in exec.js) that lazy-loads an INSTALLED @gcu extension
// which exports <name> — so `import plt` / `import sadpan` resolve from the embedded
// modules with no bootstrap `load()` cell. Standalone-safe: returns null when the hook
// is absent (Node tests, or a non-auditable host) so adder still runs on its own.
export async function _loadAuditableModule(name) {
  if (typeof window === 'undefined' || typeof window._auditableResolveModule !== 'function') return null;
  try { return await window._auditableResolveModule(name); } catch { return null; }
}

// A module's namespace: every binding the module's code makes lands on its module object as it
// is made — so a circular import (pkg/__init__ imports .a, and a imports pkg) sees the names
// bound so far, as in CPython, instead of an empty placeholder. `global x` writes in functions
// go through the same map, so they are seen too.
class _ModuleVars extends PyDict {
  set(k, v) { const r = super.set(k, v); if (this._mod && typeof k === 'string') { try { this._mod[k] = v; } catch {} } return r; }
  delete(k) { const r = super.delete(k); if (this._mod && typeof k === 'string') delete this._mod[k]; return r; }
}

// Parse + evaluate source as a fresh module, cache it under cacheKey.
// Shared by the VFS, HTTP and direct-path loaders.
//   info.package — the module's __package__ (the package itself, for a package's __init__)
//   info.path    — for a package: its __path__ (the directories its submodules are found in)
async function _instantiateModule(cacheKey, displayName, source, filePath, info = {}) {
  const cache = adderModules.sys.modules;
  // a module that doesn't parse raises SyntaxError at its import, naming the file
  let ast;
  try { ast = adderParse(source); } catch (e) {
    if (e instanceof AdderError) throw e;
    const m = /\(line (\d+)\)/.exec(String(e && e.message));
    const err = new AdderError('SyntaxError', `${String(e && e.message).replace(/\s*\(line \d+\)$/, '')} (${filePath}${m ? `, line ${m[1]}` : ''})`);
    err.filename = filePath; err.lineno = m ? Number(m[1]) : null;
    throw err;
  }
  const modScope = new AdderScope();
  const builtins = adderBuiltins(stdoutWrite);
  const builtinNames = new PySet(Object.keys(builtins));
  modScope.vars = new _ModuleVars();
  for (const [k, v] of Object.entries(builtins)) modScope.vars.set(k, v);

  // the module object, in the cache before its code runs (circular imports find it)
  const mod = { __adderModule__: true };
  cache[cacheKey] = mod;
  modScope.vars._mod = mod;

  const pkg = info.package !== undefined ? info.package : (displayName.includes('.') ? displayName.slice(0, displayName.lastIndexOf('.')) : '');
  modScope.set('__name__', displayName);
  modScope.set('__file__', filePath);
  modScope.set('__package__', pkg);
  modScope.set('__doc__', ast.body && ast.body[0] && ast.body[0].type === 'Expr' && ast.body[0].value.type === 'Constant' && typeof ast.body[0].value.value === 'string' ? ast.body[0].value.value : null);
  if (info.path) modScope.set('__path__', info.path);
  modScope.set('__spec__', { __adderClass__: 'ModuleSpec', name: displayName, origin: filePath, parent: pkg,
    submodule_search_locations: info.path || null, has_location: !!filePath, loader: null });
  modScope.set('__loader__', null);

  // AIR-compile the module when the importing program runs on AIR (the cell and its libraries on
  // one engine); a module AIR can't lower is tree-walked instead
  let compiled = null;
  if (_moduleCompiler && _runOpts.moduleEngine !== 'tree') {
    try { compiled = _moduleCompiler(ast, source, { name: displayName, package: pkg }); } catch { compiled = null; }
  }
  // the namespace of the module whose top level is running: an exec() reached without namespaces
  // from compiled code (six's `exec_ = getattr(builtins, "exec")`) runs in it, as CPython's does
  // in the calling module's
  _runningModules.push(compiled ? mod : modScope.vars);
  try {
    if (compiled) {
      const lookup = (n) => (modScope.vars.has(n) ? modScope.vars.get(n) : undefined);
      const scope = await compiled.run(lookup, mod);
      if (scope && typeof scope === 'object') {
        for (const k of Object.keys(scope)) if (k !== '__lastExpr__' && !(k in mod)) { try { mod[pyNameOfJs(k)] = scope[k]; } catch {} }
      }
    } else {
      await adderEval(ast, modScope);
    }
  } catch (e) {
    delete cache[cacheKey];          // a failed import leaves no half-module behind (CPython does the same)
    throw e;
  } finally {
    _runningModules.pop();
  }
  // what the import gives is sys.modules[name] after the code ran: a module may replace itself
  // there (pygments.lexers swaps in a lazy-loading module subclass)
  return cache[cacheKey] || mod;
}
// the compiler for imported modules (runner.js registers AIR's; none: always tree-walked)
let _moduleCompiler = null;
export function setModuleCompiler(fn) { _moduleCompiler = fn; }
const pyNameOfJs = (k) => (k.endsWith('$') ? k.slice(0, -1) : k);

// Find a top-level name on sys.path: <dir>/<name>.py, or a package <dir>/<name>/__init__.py.
export async function _loadVfsModule(name) {
  const cache = adderModules.sys.modules;
  if (cache[name]) return cache[name];
  return _loadFromDirs(name, name, adderModules.sys.path);
}

// Look for `leaf` (a module or a package) in each directory of `dirs`, instantiating it as
// `fullName`. sys.path for a top-level name; a package's __path__ for its submodules.
async function _loadFromDirs(fullName, leaf, dirs) {
  const vfs = getAdderVFS();
  if (!vfs) return null;
  const pth = _getVfsPath();
  if (!pth) return null;
  const cwd = adderModules.os?.getcwd?.() || '/';
  for (let dir of dirs || []) {
    if (typeof dir !== 'string') continue;
    if (/^https?:\/\//.test(dir)) continue;          // URL entries are _loadHttpModule's
    if (!pth.isAbsolute(dir)) dir = pth.join(cwd, dir);
    // only the READ is tried: a module that is found but fails (a syntax error, an exception in
    // its own code) propagates, never falling through to another directory
    const fp = pth.join(dir, leaf + '.py');
    const src = await _readOrNull(vfs, fp);
    if (src !== null) return _instantiateModule(fullName, fullName, src, fp);
    const pkgDir = pth.join(dir, leaf), ip = pth.join(pkgDir, '__init__.py');
    const isrc = await _readOrNull(vfs, ip);
    if (isrc !== null) return _instantiateModule(fullName, fullName, isrc, ip, { package: fullName, path: [pkgDir] });
  }
  return null;
}
async function _readOrNull(vfs, p) { try { return await vfs.readFile(p); } catch { return null; } }

// The import algorithm, shared by both engines. `name` is absolute and may be dotted:
// the parent package is imported first (running its __init__), then the submodule is looked
// up in the parent's __path__, and bound as an attribute of the parent. Returns null when
// nothing provides the name.
export async function findModule(name) {
  const cache = adderModules.sys.modules;
  if (cache[name]) return cache[name];
  // None in sys.modules blocks the import (test.support's import_fresh_module, "no C accelerator")
  if (cache[name] === null && Object.hasOwn(cache, name)) throw new AdderError('ImportError', `import of ${name} halted; None in sys.modules`);
  const known = _resolveModule(name);
  if (known) {
    // a stdlib module, once imported, is in sys.modules as CPython's are (six's
    // `__import__(name); return sys.modules[name]`)
    if (name !== 'js' && adderModules[name] === known && known.__adderModule__) cache[name] = known;
    return known;
  }
  if (Object.hasOwn(frozenPyModules, name)) {       // a stdlib module written in Python
    const fz = frozenPyModules[name];
    const dot = name.lastIndexOf('.');
    const parent = dot > 0 ? await findModule(name.slice(0, dot)) : null;
    if (cache[name]) return cache[name];
    if (fz.source === undefined) fz.source = await _gunzipBase64(fz.gz);
    if (cache[name]) return cache[name];
    const mod = await _instantiateModule(name, name, fz.source, `<frozen ${name}>`, fz.pkg ? { package: name, path: [] } : {});
    if (parent) { try { parent[name.slice(dot + 1)] = mod; } catch {} }
    return mod;
  }
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const parent = await findModule(name.slice(0, dot));
    if (!parent) return null;
    if (cache[name]) return cache[name];            // the parent's __init__ imported it
    const leaf = name.slice(dot + 1);
    let mod = null;
    if (Array.isArray(parent.__path__)) mod = await _loadFromDirs(name, leaf, parent.__path__);
    if (!mod) {                                      // a namespace object's attribute (extensions, os.path)
      const attr = parent[leaf];
      if (attr && (typeof attr === 'object' || typeof attr === 'function')) return attr;
      mod = await _loadAuditableModule(name) || await _loadHttpModule(name);
    }
    if (mod) { try { parent[leaf] = mod; } catch {} }
    return mod;
  }
  return await _loadVfsModule(name) || await _loadAuditableModule(name) || await _loadHttpModule(name);
}

// a frozen module's source (stdlib-py.js keeps them gzip-compressed, base64)
async function _gunzipBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
// findModule, raising ModuleNotFoundError (with `name` set, as CPython's has)
export async function importModule(name, line) {
  const mod = await findModule(name);
  if (mod) return mod;
  // CPython names the first component that's missing: `import nope.deeper` → 'nope'
  const parts = name.split('.');
  let missing = name;
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('.');
    if (!(await findModule(prefix))) { missing = prefix; break; }
  }
  const e = new AdderError('ModuleNotFoundError', `No module named '${missing}'${_remoteNote(missing)}`, line);
  e.name = missing;
  throw e;
}

// `from ..pkg import x` → the absolute module name, relative to the importing module's package
export function resolveRelativeImport(module, pkg, line) {
  const m = /^(\.+)(.*)$/.exec(module);
  if (!m) return module;
  if (!pkg) throw new AdderError('ImportError', 'attempted relative import with no known parent package', line);
  const parts = pkg.split('.');
  const up = m[1].length - 1;
  if (up >= parts.length) throw new AdderError('ImportError', 'attempted relative import beyond top-level package', line);
  const base = parts.slice(0, parts.length - up).join('.');
  return m[2] ? `${base}.${m[2]}` : base;
}

// `from M import a, b`: an attribute of M, or else its submodule M.a (imported on demand) —
// `from pkg import submodule` and `from . import sibling` work that way
export async function importNames(mod, modName, names, line) {
  const out = [];
  for (const { name, alias } of names) {
    if (name === '*') {
      const all = Array.isArray(mod.__all__) ? mod.__all__ : Object.keys(mod).filter((k) => !k.startsWith('_'));
      for (const k of all) out.push([k, mod[k]]);
      continue;
    }
    let v;
    if (name in mod && mod[name] !== undefined) v = mod[name];
    else {
      // an attribute the module answers for itself: a module subclass's class-level (lazy)
      // attributes (six.moves), a module __getattr__ (PEP 562)
      if (mod.__adderType__ || typeof mod.__getattr__ === 'function') {
        try { v = await adderGetAttr(mod, name); } catch (e) { if (!(e && e.pyType === 'AttributeError')) throw e; v = undefined; }
      }
      if (v === undefined && modName) v = await findModule(`${modName}.${name}`);
    }
    if (v === undefined || v === null && !(name in mod)) {
      const e = new AdderError('ImportError', `cannot import name '${name}' from '${modName}'`, line);
      e.name = modName;
      throw e;
    }
    out.push([alias || name, v]);
  }
  return out;
}

// Join a base URL with a relative path component. Ensures exactly one '/' between.
function _urlJoin(base, rel) {
  if (!base.endsWith('/')) base += '/';
  return base + rel;
}

export async function _loadHttpModule(name) {
  if (typeof fetch !== 'function' || _runOpts.remote === false) return null;
  const cache = adderModules.sys.modules;
  if (cache[name]) return cache[name];

  // Iterate sys.path entries suitable as URL bases:
  //   - absolute URLs ("https://cdn.example.com/")
  //   - relative URL bases ("./", "../lib/") resolved against document.baseURI when available
  let source = null, fetchedUrl = null;
  for (const entry of adderModules.sys.path) {
    if (typeof entry !== 'string') continue;
    let base;
    if (/^https?:\/\//.test(entry)) {
      base = entry;
    } else if (entry.startsWith('./') || entry.startsWith('../') || entry === '.' || entry === '..') {
      base = (typeof document !== 'undefined' && document.baseURI)
        ? new URL(entry === '.' ? './' : (entry === '..' ? '../' : entry), document.baseURI).href
        : null;
    } else {
      // absolute filesystem paths ("/", "/srv/lib/") are VFS territory, skip
      continue;
    }
    if (!base) continue;

    const rel = name.replace(/\./g, '/');            // a.b → a/b.py, a/b/__init__.py
    for (const candidate of [_urlJoin(base, rel + '.py'), _urlJoin(base, rel + '/__init__.py')]) {
      try {
        const resp = await fetch(candidate);
        if (resp.ok) { source = await resp.text(); fetchedUrl = candidate; break; }
      } catch {}
    }
    if (source !== null) break;
  }
  if (source === null) return null;
  const isPkg = fetchedUrl.endsWith('/__init__.py');
  return _instantiateModule(name, name, source, fetchedUrl, isPkg ? { package: name, path: [] } : {});
}

// Direct import from an explicit path/URL: `import "./foo.py" as foo`.
// Accepts absolute URLs, page-relative URLs, and VFS paths (if VFS is available).
export async function _loadDirectModule(path) {
  const cache = adderModules.sys.modules;
  if (cache[path]) return cache[path];

  // Derive a display name from the last path segment (stripped of .py).
  const base = path.split(/[/\\]/).pop() || path;
  const displayName = base.replace(/\.py$/, '') || path;

  let source = null, resolvedPath = path;

  // Absolute or page-relative URL → fetch
  if (/^https?:\/\//.test(path) || path.startsWith('./') || path.startsWith('../') || path.startsWith('/')) {
    if (typeof fetch === 'function' && _runOpts.remote !== false) {
      try {
        const url = /^https?:\/\//.test(path)
          ? path
          : (typeof document !== 'undefined' && document.baseURI)
            ? new URL(path, document.baseURI).href
            : path;
        const resp = await fetch(url);
        if (resp.ok) { source = await resp.text(); resolvedPath = url; }
      } catch {}
    }
    // VFS fallback for absolute paths when fetch failed or unavailable
    if (source === null && path.startsWith('/')) {
      const vfs = getAdderVFS();
      if (vfs) {
        try { source = await vfs.readFile(path); resolvedPath = path; } catch {}
      }
    }
  } else {
    // Bare relative form (no ./ prefix) — try VFS only; HTTP loading is opt-in via ./
    const vfs = getAdderVFS();
    if (vfs) {
      try { source = await vfs.readFile(path); resolvedPath = path; } catch {}
    }
  }

  if (source === null) return null;
  return _instantiateModule(path, displayName, source, resolvedPath);
}

// when remote imports are off and the import could only have come from the
// network (a URL path, or sys.path carrying URL bases), say so in the error
function _remoteNote(nameOrPath) {
  if (_runOpts.remote !== false) return '';
  // a bare '.' / '..' on sys.path is a network base only where document.baseURI exists (the default
  // sys.path starts with '.', and in Node that never meant the network)
  const hasBase = typeof document !== 'undefined' && !!document.baseURI;
  const urlish = (s) => typeof s === 'string' && (/^https?:\/\//.test(s) || s.startsWith('./') || s.startsWith('../') || (hasBase && (s === '.' || s === '..')));
  if (urlish(nameOrPath)) return ' (remote imports are off)';
  const sp = adderModules.sys && adderModules.sys.path;
  return Array.isArray(sp) && sp.some(urlish) ? ' (remote imports are off)' : '';
}

// `import a.b.c` binds `a`, with b and c reachable as attributes. findModule links a VFS
// package's submodules up as it loads them; for anything else (a built-in namespace, an
// extension) the chain is linked here, a namespace object standing in for a parent that is
// not a module of its own.
export async function _importRoot(module, sub) {
  const parts = module.split('.');
  let root = await findModule(parts[0]);
  if (!root || (typeof root !== 'object' && typeof root !== 'function')) root = { __adderModule__: true, __name__: parts[0] };
  let cur = root;
  for (let i = 1; i < parts.length; i++) {
    const name = parts.slice(0, i + 1).join('.');
    let next = cur[parts[i]];
    if (next === null || next === undefined || (typeof next !== 'object' && typeof next !== 'function')) {
      next = i === parts.length - 1 ? sub : (await findModule(name) || { __adderModule__: true, __name__: name });
      try { cur[parts[i]] = next; } catch { /* a frozen module: reachable already or not at all */ }
    }
    cur = next;
  }
  return root;
}

// the importing code's package, for relative imports: a module's own __package__ (a cell has none)
function _scopePackage(scope) {
  let s = scope; while (s.parent) s = s.parent;
  return s.vars.has('__package__') ? s.vars.get('__package__') : null;
}

async function _evalImport(node, scope) {
  for (const { module, alias, path } of node.names) {
    if (path) {
      const mod = await _loadDirectModule(path);
      if (!mod) throw new AdderError('ModuleNotFoundError', `cannot load module from '${path}'${_remoteNote(path)}`, node.line);
      scope.set(alias, mod);
      continue;
    }
    const mod = await importModule(module, node.line);
    // `import a.b` binds a (the root, b reachable on it); `import a.b as c` binds c to a.b itself
    scope.set(alias || module.split('.')[0], !alias && module.includes('.') ? await _importRoot(module, mod) : mod);
    // import this — print the zen (side effect, like CPython)
    if (module === 'this' && mod.s) { const printFn = scope.has('print') ? scope.get('print') : null; if (printFn) await printFn(mod.s); }
  }
  return null;
}

async function _evalImportFrom(node, scope) {
  let mod, name;
  if (node.path) {
    mod = await _loadDirectModule(node.path);
    name = null;
    if (!mod) throw new AdderError('ModuleNotFoundError', `cannot load module from '${node.path}'${_remoteNote(node.path)}`, node.line);
  } else {
    name = resolveRelativeImport(node.module, _scopePackage(scope), node.line);
    mod = await importModule(name, node.line);
  }
  for (const [k, v] of await importNames(mod, name || node.path, node.names, node.line)) scope.set(k, v);
  return null;
}

// importlib and __import__ (builtins.js) use this same machinery
_registerImportMachinery({ find: findModule, importModule, resolveRelative: resolveRelativeImport });

// re-export for cell.js
export { AdderError, adderParse };
