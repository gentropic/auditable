# _ast_validate: CPython's AST validator (Python/ast.c, 3.13.12), ported to Python — what
# compile(tree, ...) checks a tree with before compiling it: a tree built by hand raises the same
# ValueError / TypeError, with the same words, as CPython's. Plus the part of the conversion
# (Python-ast.c obj2ast) a hand-built tree meets first: a missing required field, an abstract
# node where a concrete one goes.
# A port of CPython code: PSF License 2.0 (see LICENSE-PSF.txt).

import _ast

_LIMIT = 10000   # (Py_C_RECURSION_LIMIT's order of magnitude)
_SEQ = object()


class _State:
    depth = 0


def _ctx_name(ctx):
    return type(ctx).__name__


# ── obj2ast's checks ──
def _field(node, name, owner):
    # a required field: present (an optional one may be None)
    try:
        return getattr(node, name)
    except AttributeError:
        raise TypeError(f'required field "{name}" missing from {owner}') from None


def _check_kind(node, base):
    if not isinstance(node, base):
        raise TypeError(f"expected some sort of {base.__name__}, but got {node!r}")
    if type(node) is base:
        raise TypeError(f"expected some sort of {base.__name__}, but got {node!r}")


def _positions(node):
    lineno = _field(node, 'lineno', type(node).__name__)
    col_offset = _field(node, 'col_offset', type(node).__name__)
    end_lineno = getattr(node, 'end_lineno', None)
    end_col_offset = getattr(node, 'end_col_offset', None)
    if end_lineno is None:
        end_lineno = lineno
    if end_col_offset is None:
        end_col_offset = col_offset
    if lineno > end_lineno:
        raise ValueError(f"AST node line range ({lineno}, {end_lineno}) is not valid")
    if (lineno < 0 and end_lineno != lineno) or (col_offset < 0 and col_offset != end_col_offset):
        raise ValueError(f"AST node column range ({col_offset}, {end_col_offset}) for line range ({lineno}, {end_lineno}) is not valid")
    if lineno == end_lineno and col_offset > end_col_offset:
        raise ValueError(f"line {lineno}, column {col_offset}-{end_col_offset} is not a valid range")


def _enter(state):
    state.depth += 1
    if state.depth > _LIMIT:
        raise RecursionError("maximum recursion depth exceeded during compilation")


def _name(name):
    for forbidden in ('None', 'True', 'False'):
        if name == forbidden:
            raise ValueError(f"identifier field can't represent '{forbidden}' constant")


def _comprehension(state, gens):
    if not gens:
        raise ValueError("comprehension with no generators")
    for comp in gens:
        _expr(state, _field(comp, 'target', 'comprehension'), 'Store')
        _expr(state, _field(comp, 'iter', 'comprehension'), 'Load')
        _exprs(state, _field(comp, 'ifs', 'comprehension'), 'Load', False)


def _keywords(state, keywords):
    for kw in keywords:
        _expr(state, _field(kw, 'value', 'keyword'), 'Load')


def _args(state, args):
    for arg in args:
        _positions(arg)
        if getattr(arg, 'annotation', None) is not None:
            _expr(state, arg.annotation, 'Load')


def _arguments(state, args):
    posonlyargs = _field(args, 'posonlyargs', 'arguments')
    plain = _field(args, 'args', 'arguments')
    _args(state, posonlyargs)
    _args(state, plain)
    vararg = getattr(args, 'vararg', None)
    if vararg is not None and getattr(vararg, 'annotation', None) is not None:
        _expr(state, vararg.annotation, 'Load')
    kwonlyargs = _field(args, 'kwonlyargs', 'arguments')
    _args(state, kwonlyargs)
    kwarg = getattr(args, 'kwarg', None)
    if kwarg is not None and getattr(kwarg, 'annotation', None) is not None:
        _expr(state, kwarg.annotation, 'Load')
    defaults = _field(args, 'defaults', 'arguments')
    kw_defaults = _field(args, 'kw_defaults', 'arguments')
    if len(defaults) > len(posonlyargs) + len(plain):
        raise ValueError("more positional defaults than args on arguments")
    if len(kw_defaults) != len(kwonlyargs):
        raise ValueError("length of kwonlyargs is not the same as kw_defaults on arguments")
    _exprs(state, defaults, 'Load', False)
    _exprs(state, kw_defaults, 'Load', True)


def _constant(state, value):
    if value is None or value is ...:
        return
    if type(value) in (int, float, complex, bool, str, bytes):
        return
    if type(value) in (tuple, frozenset):
        _enter(state)
        for item in value:
            _constant(state, item)
        state.depth -= 1
        return
    raise TypeError(f"got an invalid type in Constant: {type(value).__name__}")


_CTX_NODES = ('Attribute', 'Subscript', 'Starred', 'Name', 'List', 'Tuple')


def _expr(state, exp, ctx):
    _check_kind(exp, _ast.expr)
    _positions(exp)
    _enter(state)
    kind = type(exp).__name__
    if kind in _CTX_NODES:
        if kind == 'Name':
            _name(_field(exp, 'id', kind))
        actual = _ctx_name(_field(exp, 'ctx', kind))
        if actual != ctx:
            raise ValueError(f"expression must have {ctx} context but has {actual} instead")
    elif ctx != 'Load':
        raise ValueError(f"expression which can't be assigned to in {ctx} context")

    if kind == 'BoolOp':
        values = _field(exp, 'values', kind)
        if len(values) < 2:
            raise ValueError("BoolOp with less than 2 values")
        _exprs(state, values, 'Load', False)
    elif kind == 'BinOp':
        _expr(state, _field(exp, 'left', kind), 'Load')
        _expr(state, _field(exp, 'right', kind), 'Load')
    elif kind == 'UnaryOp':
        _expr(state, _field(exp, 'operand', kind), 'Load')
    elif kind == 'Lambda':
        _arguments(state, _field(exp, 'args', kind))
        _expr(state, _field(exp, 'body', kind), 'Load')
    elif kind == 'IfExp':
        _expr(state, _field(exp, 'test', kind), 'Load')
        _expr(state, _field(exp, 'body', kind), 'Load')
        _expr(state, _field(exp, 'orelse', kind), 'Load')
    elif kind == 'Dict':
        keys, values = _field(exp, 'keys', kind), _field(exp, 'values', kind)
        if len(keys) != len(values):
            raise ValueError("Dict doesn't have the same number of keys as values")
        _exprs(state, keys, 'Load', True)
        _exprs(state, values, 'Load', False)
    elif kind == 'Set':
        _exprs(state, _field(exp, 'elts', kind), 'Load', False)
    elif kind in ('ListComp', 'SetComp', 'GeneratorExp'):
        _comprehension(state, _field(exp, 'generators', kind))
        _expr(state, _field(exp, 'elt', kind), 'Load')
    elif kind == 'DictComp':
        _comprehension(state, _field(exp, 'generators', kind))
        _expr(state, _field(exp, 'key', kind), 'Load')
        _expr(state, _field(exp, 'value', kind), 'Load')
    elif kind == 'Yield':
        if getattr(exp, 'value', None) is not None:
            _expr(state, exp.value, 'Load')
    elif kind in ('YieldFrom', 'Await'):
        _expr(state, _field(exp, 'value', kind), 'Load')
    elif kind == 'Compare':
        comparators = _field(exp, 'comparators', kind)
        if not comparators:
            raise ValueError("Compare with no comparators")
        if len(comparators) != len(_field(exp, 'ops', kind)):
            raise ValueError("Compare has a different number of comparators and operands")
        _exprs(state, comparators, 'Load', False)
        _expr(state, _field(exp, 'left', kind), 'Load')
    elif kind == 'Call':
        _expr(state, _field(exp, 'func', kind), 'Load')
        _exprs(state, _field(exp, 'args', kind), 'Load', False)
        _keywords(state, _field(exp, 'keywords', kind))
    elif kind == 'Constant':
        _constant(state, _field(exp, 'value', kind))
    elif kind == 'JoinedStr':
        _exprs(state, _field(exp, 'values', kind), 'Load', False)
    elif kind == 'FormattedValue':
        _expr(state, _field(exp, 'value', kind), 'Load')
        if getattr(exp, 'format_spec', None) is not None:
            _expr(state, exp.format_spec, 'Load')
    elif kind == 'Attribute':
        _expr(state, _field(exp, 'value', kind), 'Load')
    elif kind == 'Subscript':
        _expr(state, _field(exp, 'slice', kind), 'Load')
        _expr(state, _field(exp, 'value', kind), 'Load')
    elif kind == 'Starred':
        _expr(state, _field(exp, 'value', kind), ctx)
    elif kind == 'Slice':
        for f in ('lower', 'upper', 'step'):
            if getattr(exp, f, None) is not None:
                _expr(state, getattr(exp, f), 'Load')
    elif kind in ('List', 'Tuple'):
        _exprs(state, _field(exp, 'elts', kind), ctx, False)
    elif kind == 'NamedExpr':
        if type(_field(exp, 'target', kind)).__name__ != 'Name':
            raise TypeError("NamedExpr target must be a Name")
        _expr(state, _field(exp, 'value', kind), 'Load')
    elif kind == 'Name':
        pass
    else:
        raise SystemError("unexpected expression")
    state.depth -= 1


def _literal_number(exp, real, imaginary):
    v = exp.value
    return (real and type(v) in (float, int)) or (imaginary and type(v) is complex)


def _literal_negative(exp, real, imaginary):
    if type(exp.op).__name__ != 'USub':
        return False
    operand = exp.operand
    if type(operand).__name__ != 'Constant':
        return False
    return _literal_number(operand, real, imaginary)


def _literal_complex(exp):
    left, right = exp.left, exp.right
    if type(exp.op).__name__ not in ('Add', 'Sub'):
        return False
    lk = type(left).__name__
    if lk == 'Constant':
        if not _literal_number(left, True, False):
            return False
    elif lk == 'UnaryOp':
        if not _literal_negative(left, True, False):
            return False
    else:
        return False
    if type(right).__name__ != 'Constant' or not _literal_number(right, False, True):
        return False
    return True


def _match_value(state, exp):
    _expr(state, exp, 'Load')
    kind = type(exp).__name__
    if kind == 'Constant':
        if type(exp.value) in (int, float, bytes, complex, str):
            return
        raise ValueError("unexpected constant inside of a literal pattern")
    if kind == 'Attribute':
        return
    if kind == 'UnaryOp' and _literal_negative(exp, True, True):
        return
    if kind == 'BinOp' and _literal_complex(exp):
        return
    if kind == 'JoinedStr':
        return
    raise ValueError("patterns may only match literals and attribute lookups")


def _capture(name):
    if name == '_':
        raise ValueError("can't capture name '_' in patterns")
    _name(name)


def _pattern(state, p, star_ok):
    _check_kind(p, _ast.pattern)
    _positions(p)
    _enter(state)
    kind = type(p).__name__
    if kind == 'MatchValue':
        _match_value(state, _field(p, 'value', kind))
    elif kind == 'MatchSingleton':
        v = _field(p, 'value', kind)
        if not (v is None or type(v) is bool):
            raise ValueError("MatchSingleton can only contain True, False and None")
    elif kind == 'MatchSequence':
        _patterns(state, _field(p, 'patterns', kind), True)
    elif kind == 'MatchMapping':
        keys, patterns = _field(p, 'keys', kind), _field(p, 'patterns', kind)
        if len(keys) != len(patterns):
            raise ValueError("MatchMapping doesn't have the same number of keys as patterns")
        if getattr(p, 'rest', None) is not None:
            _capture(p.rest)
        for key in keys:
            if type(key).__name__ == 'Constant' and (key.value is None or type(key.value) is bool):
                continue
            _match_value(state, key)
        _patterns(state, patterns, False)
    elif kind == 'MatchClass':
        kwd_attrs, kwd_patterns = _field(p, 'kwd_attrs', kind), _field(p, 'kwd_patterns', kind)
        if len(kwd_attrs) != len(kwd_patterns):
            raise ValueError("MatchClass doesn't have the same number of keyword attributes as patterns")
        cls = _field(p, 'cls', kind)
        _expr(state, cls, 'Load')
        while True:
            ck = type(cls).__name__
            if ck == 'Name':
                break
            if ck == 'Attribute':
                cls = cls.value
                continue
            raise ValueError("MatchClass cls field can only contain Name or Attribute nodes.")
        for identifier in kwd_attrs:
            _name(identifier)
        _patterns(state, _field(p, 'patterns', kind), False)
        _patterns(state, kwd_patterns, False)
    elif kind == 'MatchStar':
        if not star_ok:
            raise ValueError("can't use MatchStar here")
        if getattr(p, 'name', None) is not None:
            _capture(p.name)
    elif kind == 'MatchAs':
        name = getattr(p, 'name', None)
        if name is not None:
            _capture(name)
        pattern = getattr(p, 'pattern', None)
        if pattern is not None:
            if name is None:
                raise ValueError("MatchAs must specify a target name if a pattern is given")
            _pattern(state, pattern, False)
    elif kind == 'MatchOr':
        patterns = _field(p, 'patterns', kind)
        if len(patterns) < 2:
            raise ValueError("MatchOr requires at least 2 patterns")
        _patterns(state, patterns, False)
    else:
        raise SystemError("unexpected pattern")
    state.depth -= 1


def _nonempty(seq, what, owner):
    if not seq:
        raise ValueError(f"empty {what} on {owner}")


def _assignlist(state, targets, ctx):
    _nonempty(targets, 'targets', 'Delete' if ctx == 'Del' else 'Assign')
    _exprs(state, targets, ctx, False)


def _body(state, body, owner):
    _nonempty(body, 'body', owner)
    _stmts(state, body)


def _function(state, s, kind):
    _body(state, _field(s, 'body', kind), kind)
    _type_params(state, _field(s, 'type_params', kind))
    _arguments(state, _field(s, 'args', kind))
    _exprs(state, _field(s, 'decorator_list', kind), 'Load', False)
    if getattr(s, 'returns', None) is not None:
        _expr(state, s.returns, 'Load')


def _with(state, s, kind):
    items = _field(s, 'items', kind)
    _nonempty(items, 'items', kind)
    for item in items:
        _expr(state, _field(item, 'context_expr', 'withitem'), 'Load')
        if getattr(item, 'optional_vars', None) is not None:
            _expr(state, item.optional_vars, 'Store')
    _body(state, _field(s, 'body', kind), kind)


def _try(state, s, kind):
    _body(state, _field(s, 'body', kind), kind)
    handlers, finalbody, orelse = _field(s, 'handlers', kind), _field(s, 'finalbody', kind), _field(s, 'orelse', kind)
    if not handlers and not finalbody:
        raise ValueError(f"{kind} has neither except handlers nor finalbody")
    if not handlers and orelse:
        raise ValueError(f"{kind} has orelse but no except handlers")
    for handler in handlers:
        _check_kind(handler, _ast.excepthandler)
        if kind == 'Try':
            _positions(handler)
        if getattr(handler, 'type', None) is not None:
            _expr(state, handler.type, 'Load')
        _body(state, _field(handler, 'body', 'ExceptHandler'), 'ExceptHandler')
    if finalbody:
        _stmts(state, finalbody)
    if orelse:
        _stmts(state, orelse)


def _stmt(state, s):
    _check_kind(s, _ast.stmt)
    _positions(s)
    _enter(state)
    kind = type(s).__name__
    if kind in ('FunctionDef', 'AsyncFunctionDef'):
        _function(state, s, kind)
    elif kind == 'ClassDef':
        _body(state, _field(s, 'body', kind), kind)
        _type_params(state, _field(s, 'type_params', kind))
        _exprs(state, _field(s, 'bases', kind), 'Load', False)
        _keywords(state, _field(s, 'keywords', kind))
        _exprs(state, _field(s, 'decorator_list', kind), 'Load', False)
    elif kind == 'Return':
        if getattr(s, 'value', None) is not None:
            _expr(state, s.value, 'Load')
    elif kind == 'Delete':
        _assignlist(state, _field(s, 'targets', kind), 'Del')
    elif kind == 'Assign':
        _assignlist(state, _field(s, 'targets', kind), 'Store')
        _expr(state, _field(s, 'value', kind), 'Load')
    elif kind == 'AugAssign':
        _expr(state, _field(s, 'target', kind), 'Store')
        _expr(state, _field(s, 'value', kind), 'Load')
    elif kind == 'AnnAssign':
        target = _field(s, 'target', kind)
        if type(target).__name__ != 'Name' and _field(s, 'simple', kind):
            raise TypeError("AnnAssign with simple non-Name target")
        _expr(state, target, 'Store')
        if getattr(s, 'value', None) is not None:
            _expr(state, s.value, 'Load')
        _expr(state, _field(s, 'annotation', kind), 'Load')
    elif kind == 'TypeAlias':
        name = _field(s, 'name', kind)
        if type(name).__name__ != 'Name':
            raise TypeError("TypeAlias with non-Name name")
        _expr(state, name, 'Store')
        _type_params(state, _field(s, 'type_params', kind))
        _expr(state, _field(s, 'value', kind), 'Load')
    elif kind in ('For', 'AsyncFor'):
        _expr(state, _field(s, 'target', kind), 'Store')
        _expr(state, _field(s, 'iter', kind), 'Load')
        _body(state, _field(s, 'body', kind), kind)
        _stmts(state, _field(s, 'orelse', kind))
    elif kind in ('While', 'If'):
        _expr(state, _field(s, 'test', kind), 'Load')
        _body(state, _field(s, 'body', kind), kind)
        _stmts(state, _field(s, 'orelse', kind))
    elif kind in ('With', 'AsyncWith'):
        _with(state, s, kind)
    elif kind == 'Match':
        _expr(state, _field(s, 'subject', kind), 'Load')
        cases = _field(s, 'cases', kind)
        _nonempty(cases, 'cases', 'Match')
        for m in cases:
            _pattern(state, _field(m, 'pattern', 'match_case'), False)
            if getattr(m, 'guard', None) is not None:
                _expr(state, m.guard, 'Load')
            _body(state, _field(m, 'body', 'match_case'), 'match_case')
    elif kind == 'Raise':
        exc = getattr(s, 'exc', None)
        if exc is not None:
            _expr(state, exc, 'Load')
            if getattr(s, 'cause', None) is not None:
                _expr(state, s.cause, 'Load')
        elif getattr(s, 'cause', None) is not None:
            raise ValueError("Raise with cause but no exception")
    elif kind in ('Try', 'TryStar'):
        _try(state, s, kind)
    elif kind == 'Assert':
        _expr(state, _field(s, 'test', kind), 'Load')
        if getattr(s, 'msg', None) is not None:
            _expr(state, s.msg, 'Load')
    elif kind == 'Import':
        _nonempty(_field(s, 'names', kind), 'names', 'Import')
    elif kind == 'ImportFrom':
        level = getattr(s, 'level', None)
        if level is not None and level < 0:
            raise ValueError("Negative ImportFrom level")
        _nonempty(_field(s, 'names', kind), 'names', 'ImportFrom')
    elif kind in ('Global', 'Nonlocal'):
        _nonempty(_field(s, 'names', kind), 'names', kind)
    elif kind == 'Expr':
        _expr(state, _field(s, 'value', kind), 'Load')
    elif kind in ('Pass', 'Break', 'Continue'):
        pass
    else:
        raise SystemError("unexpected statement")
    state.depth -= 1


def _stmts(state, seq):
    for s in seq:
        if s is None:
            raise ValueError("None disallowed in statement list")
        _stmt(state, s)


def _exprs(state, exprs, ctx, null_ok):
    for e in exprs:
        if e is not None:
            _expr(state, e, ctx)
        elif not null_ok:
            raise ValueError("None disallowed in expression list")


def _patterns(state, patterns, star_ok):
    for p in patterns:
        _pattern(state, p, star_ok)


def _type_params(state, tps):
    for tp in tps:
        if tp is None:
            continue
        _check_kind(tp, _ast.type_param)
        _positions(tp)
        kind = type(tp).__name__
        _name(_field(tp, 'name', kind))
        if kind == 'TypeVar' and getattr(tp, 'bound', None) is not None:
            _expr(state, tp.bound, 'Load')
        if getattr(tp, 'default_value', None) is not None:
            _expr(state, tp.default_value, 'Load')


# ── obj2ast: the conversion CPython makes of a tree before validating it (Python-ast.c) — what a
# field must hold, by its declared type ──
_SIMPLE_SUMS = ('expr_context', 'boolop', 'operator', 'unaryop', 'cmpop')
_POSITIONED = ('stmt', 'expr', 'excepthandler', 'pattern', 'type_param', 'arg', 'keyword', 'alias')




def _int_value(v):
    if type(v) is not int and type(v) is not bool:
        raise ValueError(f"invalid integer value: {v!r}")


def _convert_attrs(obj, base):
    # (read first, as CPython's do: a non-node fails on its missing lineno)
    for a in getattr(base, '_attributes', ()):
        required = a in ('lineno', 'col_offset')
        if not hasattr(obj, a):
            if required:
                raise TypeError(f'required field "{a}" missing from {base.__name__}')
            continue
        v = getattr(obj, a)
        if v is None and not required:
            continue
        _int_value(v)


def _convert_node(obj, base):
    if base.__name__ in _SIMPLE_SUMS:
        if not isinstance(obj, base) or type(obj) is base:
            raise TypeError(f"expected some sort of {base.__name__}, but got {obj!r}")
        return
    if base.__name__ in _POSITIONED:
        _convert_attrs(obj, base)
    if not isinstance(obj, base) or type(obj) is base and base.__subclasses__():
        raise TypeError(f"expected some sort of {base.__name__}, but got {obj!r}")
    _convert_fields(obj)


def _convert_value(owner, name, value, t):
    # one field's value, by its type: list[X], X | None, an identifier (str), an int, an object
    # (a constant), or a node type
    origin = getattr(t, '__origin__', None)
    if origin is list:
        if not isinstance(value, list):
            raise TypeError(f'{owner} field "{name}" must be a list, not a {type(value).__name__}')
        (item,) = t.__args__
        for v in value:
            if v is not None:
                _convert_value(owner, name, v, item)
        return
    args = getattr(t, '__args__', None)
    if args is not None and type(None) in args:
        if value is None:
            return
        t = [a for a in args if a is not type(None)][0]
    if t is object:
        return
    if t is str:
        if value is None:
            raise ValueError(f"field '{name}' is required for {owner}")
        if not isinstance(value, str):
            raise TypeError("AST identifier must be of type str")
        return
    if t is int:
        if value is None:
            raise ValueError(f"field '{name}' is required for {owner}")
        _int_value(value)
        return
    if isinstance(t, type) and issubclass(t, _ast.AST):
        if value is None and t.__name__ not in _SIMPLE_SUMS:
            raise ValueError(f"field '{name}' is required for {owner}")
        _convert_node(value, t)


def _convert_fields(obj):
    cls = type(obj)
    types = getattr(cls, '_field_types', {})
    for name in cls._fields:
        if not hasattr(obj, name):
            t = types.get(name)
            if t is not None and getattr(t, '__origin__', None) is not list and not (type(None) in getattr(t, '__args__', ())):
                raise TypeError(f'required field "{name}" missing from {cls.__name__}')
            continue
        if name in types:
            _convert_value(cls.__name__, name, getattr(obj, name), types[name])


def validate(mod):
    """Check a tree as CPython's compile() does before compiling it (ValueError / TypeError)."""
    if not isinstance(mod, _ast.mod) or type(mod) is _ast.mod:
        raise TypeError(f"expected some sort of mod, but got {mod!r}")
    _convert_fields(mod)
    state = _State()
    kind = type(mod).__name__
    if kind in ('Module', 'Interactive'):
        _stmts(state, _field(mod, 'body', kind))
    elif kind == 'Expression':
        _expr(state, _field(mod, 'body', kind), 'Load')
    elif kind == 'FunctionType':
        _exprs(state, _field(mod, 'argtypes', kind), 'Load', False)
        _expr(state, _field(mod, 'returns', kind), 'Load')
    else:
        raise TypeError(f"expected some sort of mod, but got {mod!r}")
