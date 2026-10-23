// CPython's abstract syntax tree, from adder's parser: what compile(source, filename, mode,
// ast.PyCF_ONLY_AST) gives — and with it ast.parse, ast.literal_eval and everything else in
// CPython's ast.py (pylib, verbatim). adderParseAst parses in ast mode (the tree as written, each
// node with its span); this turns that tree into CPython's node shapes, as plain objects for
// _ast._from_tree (pylib/_ast.py) to build: { _type: 'BinOp', left, op, right, lineno, col_offset,
// end_lineno, end_col_offset }. Columns are UTF-8 byte offsets, as CPython's are. A float, a
// complex or the Ellipsis travels as { _k: 'float' | 'complex' | 'Ellipsis', v }.
import { adderParseAst } from './parse.js';

const _AST_BINOPS = { '+': 'Add', '-': 'Sub', '*': 'Mult', '@': 'MatMult', '/': 'Div', '%': 'Mod', '**': 'Pow', '<<': 'LShift', '>>': 'RShift', '|': 'BitOr', '^': 'BitXor', '&': 'BitAnd', '//': 'FloorDiv' };
const _AST_UNARY = { '~': 'Invert', not: 'Not', '+': 'UAdd', '-': 'USub' };
const _AST_CMPOPS = { '==': 'Eq', '!=': 'NotEq', '<': 'Lt', '<=': 'LtE', '>': 'Gt', '>=': 'GtE', is: 'Is', 'is not': 'IsNot', in: 'In', 'not in': 'NotIn' };
const _AST_BOOLOPS = { and: 'And', or: 'Or' };
const _astOp = (table, o) => ({ _type: table[o] || o });

export function cpythonAstTree(source, mode = 'exec') {
  const code = source.indexOf('\r') !== -1 ? source.replace(/\r\n?/g, '\n') : source;
  const lines = code.split('\n');
  const enc = new TextEncoder();
  const byteCol = (line, col) => {
    const l = lines[line - 1];
    if (l === undefined || col <= 0) return Math.max(0, col);
    const pre = l.slice(0, col);
    return /^[\x00-\x7f]*$/.test(pre) ? pre.length : enc.encode(pre).length;
  };
  const span = (p) => ({ lineno: p[0], col_offset: byteCol(p[0], p[1]), end_lineno: p[2], end_col_offset: byteCol(p[2], p[3]) });
  const tokSpan = (a, b) => (a && b ? [a.sl, a.sc, b.el, b.ec] : null);
  // a node's position: its own span; else the extent of its children's; else its parent's
  const place = (out, p, fallback) => {
    if (p) return Object.assign(out, span(p));
    let lo = null, hi = null;
    const visit = (v) => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach(visit); return; }
      if (v.lineno !== undefined) {
        if (!lo || v.lineno < lo[0] || (v.lineno === lo[0] && v.col_offset < lo[1])) lo = [v.lineno, v.col_offset];
        if (!hi || v.end_lineno > hi[0] || (v.end_lineno === hi[0] && v.end_col_offset > hi[1])) hi = [v.end_lineno, v.end_col_offset];
        return;
      }
      for (const k of Object.keys(v)) if (k !== '_type') visit(v[k]);
    };
    for (const k of Object.keys(out)) if (k !== '_type') visit(out[k]);
    if (lo) return Object.assign(out, { lineno: lo[0], col_offset: lo[1], end_lineno: hi[0], end_col_offset: hi[1] });
    if (fallback) return Object.assign(out, { lineno: fallback.lineno, col_offset: fallback.col_offset, end_lineno: fallback.end_lineno, end_col_offset: fallback.end_col_offset });
    return Object.assign(out, { lineno: 1, col_offset: 0, end_lineno: 1, end_col_offset: 0 });
  };

  // ── expressions ──
  const exprs = (a, ctx, up) => (a || []).map((x) => expr(x, ctx, up));
  const opt = (x, up) => (x === null || x === undefined ? null : expr(x, 'Load', up));
  function constValue(n) {
    const v = n.value;
    if (typeof v === 'number' && (n.intFloat || !Number.isInteger(v))) return { _k: 'float', v };
    if (v !== null && typeof v === 'object' && v._complex) return { _k: 'complex', v: v.imag };
    return v;
  }
  function joined(values, up) {
    // adjacent literal pieces are one Constant (CPython's "a" f"{b}" "c" keeps the text together)
    const out = [];
    for (const v of values) {
      const prev = out[out.length - 1];
      if (v.type === 'Constant' && prev && prev._type === 'Constant' && typeof prev.value === 'string') {
        prev.value += v.value;
        if (v._p) { const e = span(v._p); prev.end_lineno = e.end_lineno; prev.end_col_offset = e.end_col_offset; }
        continue;
      }
      out.push(v.type === 'Constant' ? place({ _type: 'Constant', value: v.value, kind: null }, v._p, up) : expr(v, 'Load', up));
    }
    return out;
  }
  function expr(n, ctx = 'Load', up = null) {
    if (n === null || n === undefined) return null;
    const out = { _type: n.type };
    const c = () => ({ _type: ctx });
    // the node's own position first, so its children can fall back on it
    if (n._p) Object.assign(out, span(n._p));
    const me = n._p ? out : up;
    switch (n.type) {
      case 'BoolOp': Object.assign(out, { op: _astOp(_AST_BOOLOPS, n.op), values: exprs(n.values, 'Load', me) }); break;
      case 'NamedExpr': Object.assign(out, { target: expr(n.target, 'Store', me), value: expr(n.value, 'Load', me) }); break;
      case 'BinOp': Object.assign(out, { left: expr(n.left, 'Load', me), op: _astOp(_AST_BINOPS, n.op), right: expr(n.right, 'Load', me) }); break;
      case 'UnaryOp': Object.assign(out, { op: _astOp(_AST_UNARY, n.op), operand: expr(n.operand, 'Load', me) }); break;
      case 'Lambda': Object.assign(out, { args: argumentsOf(n, false, me), body: expr(n.body, 'Load', me) }); break;
      case 'IfExp': Object.assign(out, { test: expr(n.test, 'Load', me), body: expr(n.body, 'Load', me), orelse: expr(n.orelse, 'Load', me) }); break;
      case 'Dict': Object.assign(out, { keys: n.keys.map((k) => (k === null ? null : expr(k, 'Load', me))), values: exprs(n.values, 'Load', me) }); break;
      case 'Set': Object.assign(out, { elts: exprs(n.elts, 'Load', me) }); break;
      case 'ListComp': case 'SetComp': case 'GeneratorExp':
        Object.assign(out, { elt: expr(n.elt, 'Load', me), generators: comprehensions(n.generators, me) }); break;
      case 'DictComp': Object.assign(out, { key: expr(n.key, 'Load', me), value: expr(n.value, 'Load', me), generators: comprehensions(n.generators, me) }); break;
      case 'Await': case 'YieldFrom': Object.assign(out, { value: expr(n.value, 'Load', me) }); break;
      case 'Yield': Object.assign(out, { value: opt(n.value, me) }); break;
      case 'Compare': Object.assign(out, { left: expr(n.left, 'Load', me), ops: n.ops.map((o) => _astOp(_AST_CMPOPS, o)), comparators: exprs(n.comparators, 'Load', me) }); break;
      case 'Call': Object.assign(out, { func: expr(n.func, 'Load', me), args: exprs(n.args, 'Load', me), keywords: (n.keywords || []).map((k) => keyword(k, me)) }); break;
      case 'JoinedStr': Object.assign(out, { values: joined(n.values, me) }); break;
      case 'FormattedValue': {
        const spec = n.formatSpec;
        Object.assign(out, {
          value: expr(n.value, 'Load', me),
          conversion: n.conversion ? n.conversion.charCodeAt(0) : -1,
          format_spec: spec === null || spec === undefined ? null
            : typeof spec === 'string' ? place({ _type: 'JoinedStr', values: [place({ _type: 'Constant', value: spec, kind: null }, null, me)] }, null, me)
            : expr(spec, 'Load', me),
        });
        break;
      }
      case 'Constant': Object.assign(out, { value: constValue(n), kind: n._u ? 'u' : null }); break;   // (u'' keeps its prefix as kind)
      case 'Bytes': {
        const b = new Uint8Array(n.value.length);
        for (let i = 0; i < n.value.length; i++) b[i] = n.value.charCodeAt(i) & 0xff;
        out._type = 'Constant';
        Object.assign(out, { value: b, kind: null });
        break;
      }
      case 'Name':
        if (n.ellipsis) { out._type = 'Constant'; Object.assign(out, { value: { _k: 'Ellipsis' }, kind: null }); break; }
        Object.assign(out, { id: n.id, ctx: c() }); break;
      case 'Attribute': Object.assign(out, { value: expr(n.value, 'Load', me), attr: n.attr, ctx: c() }); break;
      case 'Subscript': Object.assign(out, { value: expr(n.value, 'Load', me), slice: expr(n.slice, 'Load', me), ctx: c() }); break;
      case 'Starred': Object.assign(out, { value: expr(n.value, ctx, me), ctx: c() }); break;
      case 'List': case 'Tuple': Object.assign(out, { elts: exprs(n.elts, ctx, me), ctx: c() }); break;
      case 'Slice': Object.assign(out, { lower: opt(n.lower, me), upper: opt(n.upper, me), step: opt(n.step, me) }); break;
      default: throw new SyntaxError(`ast: no CPython node for adder's ${n.type} (line ${n.line})`);
    }
    return n._p ? out : place(out, null, up);
  }
  function keyword(k, up) {
    return place({ _type: 'keyword', arg: k.name !== undefined ? k.name : (k.arg ?? null), value: expr(k.value, 'Load', up) }, k._p || null, up);
  }
  function comprehensions(gens, up) {
    return gens.map((g) => ({ _type: 'comprehension', target: expr(g.target, 'Store', up), iter: expr(g.iter, 'Load', up), ifs: exprs(g.ifs, 'Load', up), is_async: g.isAsync ? 1 : 0 }));
  }
  function argOf(name, ann, tok, up) {
    if (name === null || name === undefined) return null;
    const out = { _type: 'arg', arg: name, annotation: ann ? expr(ann, 'Load', up) : null, type_comment: null };
    if (!tok) return place(out, null, up);
    const end = out.annotation ? [out.annotation.end_lineno, out.annotation.end_col_offset] : null;
    Object.assign(out, span([tok.sl, tok.sc, tok.el, tok.ec]));
    if (end) { out.end_lineno = end[0]; out.end_col_offset = end[1]; }
    return out;
  }
  function argumentsOf(n, isDef, up) {
    const params = n.params || [], kwonly = n.kwonly || [], posonly = n.posonly || 0;
    const a = (p) => argOf(p.name, isDef ? p.annotation : null, p._tok, up);
    return {
      _type: 'arguments',
      posonlyargs: params.slice(0, posonly).map(a),
      args: params.slice(posonly).map(a),
      vararg: argOf(n.vararg, isDef ? n.varargAnnotation : null, n._varargTok, up),
      kwonlyargs: kwonly.map(a),
      kw_defaults: kwonly.map((p) => (p.default ? expr(p.default, 'Load', up) : null)),
      kwarg: argOf(n.kwarg, isDef ? n.kwargAnnotation : null, n._kwargTok, up),
      defaults: params.filter((p) => p.default).map((p) => expr(p.default, 'Load', up)),
    };
  }
  function typeParams(tps, up) {
    return (tps || []).map((tp) => {
      const out = tp.kind === 'TypeVar'
        ? { _type: 'TypeVar', name: tp.name, bound: opt(tp.bound, up), default_value: opt(tp.default, up) }
        : { _type: tp.kind, name: tp.name, default_value: opt(tp.default, up) };
      return place(out, tokSpan(tp._tok, tp._end), up);
    });
  }

  // ── patterns ──
  function pattern(p, up) {
    if (!p) return null;
    const out = { _type: p.type };
    if (p._p) Object.assign(out, span(p._p));
    const me = p._p ? out : up;
    const pats = (a) => (a || []).map((x) => pattern(x, me));
    switch (p.type) {
      case 'MatchValue': out.value = expr(p.value, 'Load', me); break;
      case 'MatchSingleton': out.value = p.value; break;
      case 'MatchSequence': out.patterns = pats(p.patterns); break;
      case 'MatchMapping': Object.assign(out, { keys: exprs(p.keys, 'Load', me), patterns: pats(p.patterns), rest: p.rest ?? null }); break;
      case 'MatchClass': Object.assign(out, { cls: expr(p.cls, 'Load', me), patterns: pats(p.patterns), kwd_attrs: p.kwdAttrs || [], kwd_patterns: pats(p.kwdPatterns) }); break;
      case 'MatchStar': out.name = p.name ?? null; break;
      case 'MatchAs': Object.assign(out, { pattern: pattern(p.pattern, me), name: p.name ?? null }); break;
      case 'MatchOr': out.patterns = pats(p.patterns); break;
      default: throw new SyntaxError(`ast: no CPython pattern for adder's ${p.type}`);
    }
    return p._p ? out : place(out, null, up);
  }

  // ── statements ──
  const stmts = (a, up) => (a || []).map((s) => stmt(s, up));
  function stmt(n, up) {
    const out = { _type: n.type };
    if (n._p) Object.assign(out, span(n._p));
    const me = n._p ? out : up;
    const e = (x, ctx = 'Load') => expr(x, ctx, me);
    switch (n.type) {
      case 'FunctionDef': case 'AsyncFunctionDef':
        Object.assign(out, { name: n.name, args: argumentsOf(n, true, me), body: stmts(n.body, me), decorator_list: exprs(n.decorators, 'Load', me), returns: n.returns ? e(n.returns) : null, type_comment: null, type_params: typeParams(n.typeParams, me) });
        break;
      case 'ClassDef':
        Object.assign(out, { name: n.name, bases: exprs(n.bases, 'Load', me), keywords: (n.keywords || []).map((k) => place({ _type: 'keyword', arg: k.arg ?? null, value: e(k.value) }, null, me)), body: stmts(n.body, me), decorator_list: exprs(n.decorators, 'Load', me), type_params: typeParams(n.typeParams, me) });
        // (a class keyword's span: from its first token to its value's end)
        (n.keywords || []).forEach((k, i) => { if (k._tok) { const o = out.keywords[i]; Object.assign(o, span([k._tok.sl, k._tok.sc, k._tok.el, k._tok.ec])); o.end_lineno = o.value.end_lineno; o.end_col_offset = o.value.end_col_offset; } });
        break;
      case 'Return': out.value = n.value ? e(n.value) : null; break;
      case 'Delete': out.targets = exprs(n.targets, 'Del', me); break;
      case 'Assign': Object.assign(out, { targets: exprs(n.targets, 'Store', me), value: e(n.value), type_comment: null }); break;
      case 'TypeAlias': {
        const nt = n._tok;
        const name = { _type: 'Name', id: n.name, ctx: { _type: 'Store' } };
        Object.assign(out, { name: nt ? Object.assign(name, span([nt.sl, nt.sc, nt.el, nt.ec])) : place(name, null, me), type_params: typeParams(n.typeParams, me), value: e(n.value) });
        break;
      }
      case 'AugAssign': Object.assign(out, { target: e(n.target, 'Store'), op: _astOp(_AST_BINOPS, n.op), value: e(n.value) }); break;
      case 'AnnAssign': Object.assign(out, { target: e(n.target, 'Store'), annotation: e(n.annotation), value: n.value ? e(n.value) : null, simple: n.target.type === 'Name' ? 1 : 0 }); break;
      case 'For': case 'AsyncFor':
        out._type = n.isAsync ? 'AsyncFor' : 'For';
        Object.assign(out, { target: e(n.target, 'Store'), iter: e(n.iter), body: stmts(n.body, me), orelse: stmts(n.orelse, me), type_comment: null });
        break;
      case 'While': Object.assign(out, { test: e(n.test), body: stmts(n.body, me), orelse: stmts(n.orelse, me) }); break;
      case 'If': Object.assign(out, { test: e(n.test), body: stmts(n.body, me), orelse: stmts(n.orelse, me) }); break;
      case 'With': case 'AsyncWith':
        out._type = n.isAsync ? 'AsyncWith' : 'With';
        Object.assign(out, { items: n.items.map((it) => ({ _type: 'withitem', context_expr: e(it.contextExpr), optional_vars: it.optionalVar ? e(it.optionalVar, 'Store') : null })), body: stmts(n.body, me), type_comment: null });
        break;
      case 'Match':
        Object.assign(out, { subject: e(n.subject), cases: n.cases.map((c) => ({ _type: 'match_case', pattern: pattern(c.pattern, me), guard: c.guard ? e(c.guard) : null, body: stmts(c.body, me) })) });
        break;
      case 'Raise': Object.assign(out, { exc: n.exc ? e(n.exc) : null, cause: n.hasCause ? e(n.cause) : null }); break;
      case 'Try':
        if (n.star) out._type = 'TryStar';
        Object.assign(out, {
          body: stmts(n.body, me),
          handlers: n.handlers.map((h) => {
            const ho = { _type: 'ExceptHandler', type: h.excType ? e(h.excType) : null, name: h.name ?? null, body: stmts(h.body, me) };
            const last = ho.body[ho.body.length - 1];
            if (h._tok && last) return Object.assign(ho, span([h._tok.sl, h._tok.sc, h._tok.sl, h._tok.sc]), { end_lineno: last.end_lineno, end_col_offset: last.end_col_offset });
            return place(ho, null, me);
          }),
          orelse: stmts(n.orelse, me),
          finalbody: stmts(n.finalbody, me),
        });
        break;
      case 'Assert': Object.assign(out, { test: e(n.test), msg: n.msg ? e(n.msg) : null }); break;
      case 'Import': out.names = n.names.map((a) => place({ _type: 'alias', name: a.module ?? a.path, asname: a.alias ?? null }, tokSpan(a._tok, a._end), me)); break;
      case 'ImportFrom': {
        const full = n.module ?? n.path ?? '';
        const level = /^\.*/.exec(full)[0].length;
        Object.assign(out, { module: full.slice(level) || null, names: n.names.map((a) => place({ _type: 'alias', name: a.name, asname: a.alias ?? null }, tokSpan(a._tok, a._end), me)), level });
        break;
      }
      case 'Global': case 'Nonlocal': out.names = [...n.names]; break;
      case 'Expr': out.value = e(n.value); break;
      case 'Pass': case 'Break': case 'Continue': break;
      default: throw new SyntaxError(`ast: no CPython statement for adder's ${n.type} (line ${n.line})`);
    }
    return n._p ? out : place(out, null, up);
  }

  const tree = adderParseAst(code, mode);
  if (tree.type === 'Expression') return { _type: 'Expression', body: expr(tree.body) };
  if (tree.type === 'Interactive') return { _type: 'Interactive', body: stmts(tree.body, null) };
  return { _type: 'Module', body: stmts(tree.body, null), type_ignores: [] };
}
