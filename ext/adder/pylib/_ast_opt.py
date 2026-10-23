# _ast_opt: CPython's AST optimizer (Python/ast_opt.c, 3.13.12), ported to Python — what
# compile(..., PyCF_OPTIMIZED_AST) and ast.parse(..., optimize=1) do to a tree: constant folding
# (1 + 2 → 3, -1, (1,) * 3, (1, 2)[0], '%s' % (a,) → f'{a!s}'), `not (a is b)` → `a is not b`,
# a literal list / set in `in` or a `for` made a tuple / frozenset, __debug__ by the optimization
# level. A node C rewrites in place is here returned as its replacement.
# A port of CPython code: PSF License 2.0 (see LICENSE-PSF.txt).

import _ast

_MAX_INT_SIZE = 128          # bits
_MAX_COLLECTION_SIZE = 256   # items
_MAX_STR_SIZE = 4096         # characters
_MAX_TOTAL_ITEMS = 1024      # including nested collections
_LIMIT = 10000
_CO_FUTURE_ANNOTATIONS = 0x1000000


class _State:
    def __init__(self, optimize, ff_features):
        self.optimize = optimize
        self.ff_features = ff_features
        self.depth = 0


class _NoValue(Exception):
    pass


def _kind(n):
    return type(n).__name__


def _const(node, value):
    # make_const: the node, now a Constant of value, where it was
    c = _ast.Constant(value=value, kind=None)
    for a in ('lineno', 'col_offset', 'end_lineno', 'end_col_offset'):
        if hasattr(node, a):
            setattr(c, a, getattr(node, a))
    return c


def _has_starred(elts):
    return any(_kind(e) == 'Starred' for e in elts)


def _fold_unaryop(node, state):
    arg = node.operand
    if _kind(arg) != 'Constant':
        # not into the comparison: not (a is b) → a is not b (Eq / Lt … don't invert safely)
        if _kind(node.op) == 'Not' and _kind(arg) == 'Compare' and len(arg.ops) == 1:
            swap = {'Is': _ast.IsNot, 'IsNot': _ast.Is, 'In': _ast.NotIn, 'NotIn': _ast.In}.get(_kind(arg.ops[0]))
            if swap is not None:
                arg.ops[0] = swap()
                return arg
        return node
    v = arg.value
    try:
        op = _kind(node.op)
        if op == 'Invert':
            r = ~v
        elif op == 'Not':
            r = not v
        elif op == 'UAdd':
            r = +v
        else:
            r = -v
    except Exception:
        return node
    return _const(node, r)


def _check_complexity(obj, limit):
    if type(obj) is tuple:
        limit -= len(obj)
        for item in obj:
            if limit < 0:
                break
            limit = _check_complexity(item, limit)
    return limit


def _safe_multiply(v, w):
    if type(v) is int and type(w) is int and v and w:
        if v.bit_length() + w.bit_length() > _MAX_INT_SIZE:
            raise _NoValue
    elif type(v) is int and type(w) is tuple:
        if w:
            if v < 0 or v > _MAX_COLLECTION_SIZE // len(w):
                raise _NoValue
            if v and _check_complexity(w, _MAX_TOTAL_ITEMS // v) < 0:
                raise _NoValue
    elif type(v) is int and type(w) in (str, bytes):
        if w:
            if v < 0 or v > _MAX_STR_SIZE // len(w):
                raise _NoValue
    elif type(w) is int and type(v) in (tuple, str, bytes):
        return _safe_multiply(w, v)
    return v * w


def _safe_power(v, w):
    if type(v) is int and type(w) is int and v and w > 0:
        if v.bit_length() > _MAX_INT_SIZE // w:
            raise _NoValue
    return v ** w


def _safe_lshift(v, w):
    if type(v) is int and type(w) is int and v and w:
        if w > _MAX_INT_SIZE or v.bit_length() > _MAX_INT_SIZE - w:
            raise _NoValue
    return v << w


def _safe_mod(v, w):
    if type(v) in (str, bytes):
        raise _NoValue
    return v % w


# '%s' % (a,) → f'{a!s}' (the simple format units only)
def _parse_literal(fmt, pos):
    start = pos
    has_percents = False
    while pos < len(fmt):
        if fmt[pos] != '%':
            pos += 1
        elif pos + 1 < len(fmt) and fmt[pos + 1] == '%':
            has_percents = True
            pos += 2
        else:
            break
    if pos == start:
        return None, pos
    s = fmt[start:pos]
    if has_percents:
        s = s.replace('%%', '%')
    c = _ast.Constant(value=s, kind=None)
    c.lineno = c.col_offset = c.end_lineno = c.end_col_offset = -1
    return c, pos


def _simple_format_arg(fmt, pos):
    n = len(fmt)
    flags = ''
    while True:
        if pos >= n:
            return None
        ch = fmt[pos]
        pos += 1
        if ch in '-+ #0':
            flags += ch
            continue
        break
    width = prec = -1
    if '0' <= ch <= '9':
        width = 0
        digits = 0
        while '0' <= ch <= '9':
            width = width * 10 + ord(ch) - 48
            if pos >= n:
                return None
            ch = fmt[pos]
            pos += 1
            digits += 1
            if digits >= 3:
                return None
    if ch == '.':
        if pos >= n:
            return None
        ch = fmt[pos]
        pos += 1
        prec = 0
        if '0' <= ch <= '9':
            digits = 0
            while '0' <= ch <= '9':
                prec = prec * 10 + ord(ch) - 48
                if pos >= n:
                    return None
                ch = fmt[pos]
                pos += 1
                digits += 1
                if digits >= 3:
                    return None
    return ch, flags, width, prec, pos


def _parse_format(fmt, pos, arg):
    parsed = _simple_format_arg(fmt, pos)
    if parsed is None:
        return None, pos
    spec, flags, width, prec, pos = parsed
    if spec not in 'sra':
        return None, pos
    buf = ''
    if '-' not in flags and width > 0:
        buf += '>'
    if width >= 0:
        buf += str(width)
    if prec >= 0:
        buf += '.' + str(prec)
    format_spec = None
    if buf:
        format_spec = _ast.Constant(value=buf, kind=None)
        format_spec.lineno = format_spec.col_offset = format_spec.end_lineno = format_spec.end_col_offset = -1
    fv = _ast.FormattedValue(value=arg, conversion=ord(spec), format_spec=format_spec)
    for a in ('lineno', 'col_offset', 'end_lineno', 'end_col_offset'):
        setattr(fv, a, getattr(arg, a, None))
    return fv, pos


def _optimize_format(node, fmt, elts):
    pos = cnt = 0
    seq = []
    while True:
        lit, pos = _parse_literal(fmt, pos)
        if lit is not None:
            seq.append(lit)
        if pos >= len(fmt):
            break
        if cnt >= len(elts):
            return node          # more format units than items
        pos += 1                 # (the '%')
        expr, pos = _parse_format(fmt, pos, elts[cnt])
        cnt += 1
        if expr is None:
            return node          # an unsupported format
        seq.append(expr)
    if cnt < len(elts):
        return node              # more items than format units
    js = _ast.JoinedStr(values=seq)
    for a in ('lineno', 'col_offset', 'end_lineno', 'end_col_offset'):
        setattr(js, a, getattr(node, a, None))
    return js


def _fold_binop(node, state):
    lhs, rhs = node.left, node.right
    if _kind(lhs) != 'Constant':
        return node
    lv = lhs.value
    op = _kind(node.op)
    if op == 'Mod' and _kind(rhs) == 'Tuple' and isinstance(lv, str) and not _has_starred(rhs.elts):
        return _optimize_format(node, lv, rhs.elts)
    if _kind(rhs) != 'Constant':
        return node
    rv = rhs.value
    try:
        if op == 'Add':
            r = lv + rv
        elif op == 'Sub':
            r = lv - rv
        elif op == 'Mult':
            r = _safe_multiply(lv, rv)
        elif op == 'Div':
            r = lv / rv
        elif op == 'FloorDiv':
            r = lv // rv
        elif op == 'Mod':
            r = _safe_mod(lv, rv)
        elif op == 'Pow':
            r = _safe_power(lv, rv)
        elif op == 'LShift':
            r = _safe_lshift(lv, rv)
        elif op == 'RShift':
            r = lv >> rv
        elif op == 'BitOr':
            r = lv | rv
        elif op == 'BitXor':
            r = lv ^ rv
        elif op == 'BitAnd':
            r = lv & rv
        else:                    # MatMult: no builtin constant has it
            return node
    except Exception:
        return node
    return _const(node, r)


def _const_tuple(elts):
    if all(_kind(e) == 'Constant' for e in elts):
        return tuple(e.value for e in elts)
    raise _NoValue


def _fold_tuple(node, state):
    if _kind(node.ctx) != 'Load':
        return node
    try:
        return _const(node, _const_tuple(node.elts))
    except _NoValue:
        return node


def _fold_subscr(node, state):
    arg, idx = node.value, node.slice
    if _kind(node.ctx) != 'Load' or _kind(arg) != 'Constant' or _kind(idx) != 'Constant':
        return node
    try:
        return _const(node, arg.value[idx.value])
    except Exception:
        return node


def _fold_iter(arg, state):
    # a literal list (no starred items) → a tuple (a constant one when it can be); a literal set
    # of constants → a frozenset
    k = _kind(arg)
    if k == 'List':
        if _has_starred(arg.elts):
            return arg
        t = _ast.Tuple(elts=arg.elts, ctx=arg.ctx)
        for a in ('lineno', 'col_offset', 'end_lineno', 'end_col_offset'):
            if hasattr(arg, a):
                setattr(t, a, getattr(arg, a))
        try:
            return _const(t, _const_tuple(arg.elts))
        except _NoValue:
            return t
    if k == 'Set':
        try:
            return _const(arg, frozenset(_const_tuple(arg.elts)))
        except (_NoValue, TypeError):
            return arg
    return arg


def _fold_compare(node, state):
    i = len(node.ops) - 1
    if _kind(node.ops[i]) in ('In', 'NotIn'):
        node.comparators[i] = _fold_iter(node.comparators[i], state)
    return node


def _docstring(stmts):
    if stmts and _kind(stmts[0]) == 'Expr':
        e = stmts[0].value
        return _kind(e) == 'Constant' and type(e.value) is str
    return False


def _body(stmts, state):
    docstring = _docstring(stmts)
    _stmt_seq(stmts, state)
    if not docstring and _docstring(stmts):
        # a docstring made by folding isn't one: it stays an expression (a JoinedStr)
        st = stmts[0]
        js = _ast.JoinedStr(values=[st.value])
        for a in ('lineno', 'col_offset', 'end_lineno', 'end_col_offset'):
            setattr(js, a, getattr(st, a, None))
        st.value = js


def _expr_seq(seq, state):
    for i, e in enumerate(seq):
        if e is not None:
            seq[i] = _expr(e, state)


def _stmt_seq(seq, state):
    for s in seq:
        if s is not None:
            _stmt(s, state)


def _enter(state):
    state.depth += 1
    if state.depth > _LIMIT:
        raise RecursionError("maximum recursion depth exceeded during compilation")


def _expr(node, state):
    _enter(state)
    k = _kind(node)
    if k == 'BoolOp':
        _expr_seq(node.values, state)
    elif k == 'BinOp':
        node.left = _expr(node.left, state)
        node.right = _expr(node.right, state)
        node = _fold_binop(node, state)
    elif k == 'UnaryOp':
        node.operand = _expr(node.operand, state)
        node = _fold_unaryop(node, state)
    elif k == 'Lambda':
        _arguments(node.args, state)
        node.body = _expr(node.body, state)
    elif k == 'IfExp':
        node.test = _expr(node.test, state)
        node.body = _expr(node.body, state)
        node.orelse = _expr(node.orelse, state)
    elif k == 'Dict':
        _expr_seq(node.keys, state)
        _expr_seq(node.values, state)
    elif k == 'Set':
        _expr_seq(node.elts, state)
    elif k in ('ListComp', 'SetComp', 'GeneratorExp'):
        node.elt = _expr(node.elt, state)
        for g in node.generators:
            _comprehension(g, state)
    elif k == 'DictComp':
        node.key = _expr(node.key, state)
        node.value = _expr(node.value, state)
        for g in node.generators:
            _comprehension(g, state)
    elif k in ('Await', 'YieldFrom'):
        node.value = _expr(node.value, state)
    elif k == 'Yield':
        if node.value is not None:
            node.value = _expr(node.value, state)
    elif k == 'Compare':
        node.left = _expr(node.left, state)
        _expr_seq(node.comparators, state)
        node = _fold_compare(node, state)
    elif k == 'Call':
        node.func = _expr(node.func, state)
        _expr_seq(node.args, state)
        for kw in node.keywords:
            kw.value = _expr(kw.value, state)
    elif k == 'FormattedValue':
        node.value = _expr(node.value, state)
        if node.format_spec is not None:
            node.format_spec = _expr(node.format_spec, state)
    elif k == 'JoinedStr':
        _expr_seq(node.values, state)
    elif k == 'Attribute':
        node.value = _expr(node.value, state)
    elif k == 'Subscript':
        node.value = _expr(node.value, state)
        node.slice = _expr(node.slice, state)
        node = _fold_subscr(node, state)
    elif k == 'Starred':
        node.value = _expr(node.value, state)
    elif k == 'Slice':
        for f in ('lower', 'upper', 'step'):
            if getattr(node, f) is not None:
                setattr(node, f, _expr(getattr(node, f), state))
    elif k == 'List':
        _expr_seq(node.elts, state)
    elif k == 'Tuple':
        _expr_seq(node.elts, state)
        node = _fold_tuple(node, state)
    elif k == 'Name':
        if _kind(node.ctx) == 'Load' and node.id == '__debug__':
            state.depth -= 1
            return _const(node, not state.optimize)
    elif k == 'NamedExpr':
        node.value = _expr(node.value, state)
    state.depth -= 1
    return node


def _comprehension(g, state):
    g.target = _expr(g.target, state)
    g.iter = _expr(g.iter, state)
    _expr_seq(g.ifs, state)
    g.iter = _fold_iter(g.iter, state)


def _annotations_folded(state):
    return not (state.ff_features & _CO_FUTURE_ANNOTATIONS)


def _arg(a, state):
    if _annotations_folded(state) and a.annotation is not None:
        a.annotation = _expr(a.annotation, state)


def _arguments(args, state):
    for a in args.posonlyargs:
        _arg(a, state)
    for a in args.args:
        _arg(a, state)
    if args.vararg is not None:
        _arg(args.vararg, state)
    for a in args.kwonlyargs:
        _arg(a, state)
    _expr_seq(args.kw_defaults, state)
    if args.kwarg is not None:
        _arg(args.kwarg, state)
    _expr_seq(args.defaults, state)


def _type_params(tps, state):
    for tp in tps:
        if _kind(tp) == 'TypeVar' and tp.bound is not None:
            tp.bound = _expr(tp.bound, state)
        if getattr(tp, 'default_value', None) is not None:
            tp.default_value = _expr(tp.default_value, state)


def _pattern(p, state):
    _enter(state)
    k = _kind(p)
    if k == 'MatchValue':
        p.value = _expr(p.value, state)
    elif k == 'MatchSequence':
        for x in p.patterns:
            _pattern(x, state)
    elif k == 'MatchMapping':
        _expr_seq(p.keys, state)
        for x in p.patterns:
            _pattern(x, state)
    elif k == 'MatchClass':
        p.cls = _expr(p.cls, state)
        for x in p.patterns:
            _pattern(x, state)
        for x in p.kwd_patterns:
            _pattern(x, state)
    elif k == 'MatchAs':
        if p.pattern is not None:
            _pattern(p.pattern, state)
    elif k == 'MatchOr':
        for x in p.patterns:
            _pattern(x, state)
    state.depth -= 1


def _stmt(node, state):
    _enter(state)
    k = _kind(node)
    if k in ('FunctionDef', 'AsyncFunctionDef'):
        _type_params(node.type_params, state)
        _arguments(node.args, state)
        _body(node.body, state)
        _expr_seq(node.decorator_list, state)
        if _annotations_folded(state) and node.returns is not None:
            node.returns = _expr(node.returns, state)
    elif k == 'ClassDef':
        _type_params(node.type_params, state)
        _expr_seq(node.bases, state)
        for kw in node.keywords:
            kw.value = _expr(kw.value, state)
        _body(node.body, state)
        _expr_seq(node.decorator_list, state)
    elif k == 'Return':
        if node.value is not None:
            node.value = _expr(node.value, state)
    elif k == 'Delete':
        _expr_seq(node.targets, state)
    elif k == 'Assign':
        _expr_seq(node.targets, state)
        node.value = _expr(node.value, state)
    elif k == 'AugAssign':
        node.target = _expr(node.target, state)
        node.value = _expr(node.value, state)
    elif k == 'AnnAssign':
        node.target = _expr(node.target, state)
        if _annotations_folded(state):
            node.annotation = _expr(node.annotation, state)
        if node.value is not None:
            node.value = _expr(node.value, state)
    elif k == 'TypeAlias':
        node.name = _expr(node.name, state)
        _type_params(node.type_params, state)
        node.value = _expr(node.value, state)
    elif k == 'For':
        node.target = _expr(node.target, state)
        node.iter = _expr(node.iter, state)
        _stmt_seq(node.body, state)
        _stmt_seq(node.orelse, state)
        node.iter = _fold_iter(node.iter, state)
    elif k == 'AsyncFor':
        node.target = _expr(node.target, state)
        node.iter = _expr(node.iter, state)
        _stmt_seq(node.body, state)
        _stmt_seq(node.orelse, state)
    elif k in ('While', 'If'):
        node.test = _expr(node.test, state)
        _stmt_seq(node.body, state)
        _stmt_seq(node.orelse, state)
    elif k in ('With', 'AsyncWith'):
        for item in node.items:
            item.context_expr = _expr(item.context_expr, state)
            if item.optional_vars is not None:
                item.optional_vars = _expr(item.optional_vars, state)
        _stmt_seq(node.body, state)
    elif k == 'Raise':
        if node.exc is not None:
            node.exc = _expr(node.exc, state)
        if node.cause is not None:
            node.cause = _expr(node.cause, state)
    elif k in ('Try', 'TryStar'):
        _stmt_seq(node.body, state)
        for h in node.handlers:
            if h.type is not None:
                h.type = _expr(h.type, state)
            _stmt_seq(h.body, state)
        _stmt_seq(node.orelse, state)
        _stmt_seq(node.finalbody, state)
    elif k == 'Assert':
        node.test = _expr(node.test, state)
        if node.msg is not None:
            node.msg = _expr(node.msg, state)
    elif k == 'Expr':
        node.value = _expr(node.value, state)
    elif k == 'Match':
        node.subject = _expr(node.subject, state)
        for c in node.cases:
            _pattern(c.pattern, state)
            if c.guard is not None:
                c.guard = _expr(c.guard, state)
            _stmt_seq(c.body, state)
    state.depth -= 1


def _future_annotations(mod):
    # `from __future__ import annotations` among the module's leading statements
    body = getattr(mod, 'body', None)
    if not isinstance(body, list):
        return False
    i = 1 if _docstring(body) else 0
    while i < len(body) and _kind(body[i]) == 'ImportFrom' and body[i].module == '__future__':
        if any(a.name == 'annotations' for a in body[i].names):
            return True
        i += 1
    return False


def optimize(mod, optimize=0, flags=0):
    """Fold the tree in place, as CPython's compile does with PyCF_OPTIMIZED_AST; return it."""
    ff = flags & _CO_FUTURE_ANNOTATIONS
    if _future_annotations(mod):
        ff |= _CO_FUTURE_ANNOTATIONS
    state = _State(optimize, ff)
    k = _kind(mod)
    if k == 'Module':
        _body(mod.body, state)
    elif k == 'Interactive':
        _stmt_seq(mod.body, state)
    elif k == 'Expression':
        mod.body = _expr(mod.body, state)
    return mod
