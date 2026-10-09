# The normaliser both sides run: real numpy in CPython (gen.py) and each bridge in
# adder (numpy-parity.test.mjs). Written in the Python subset adder handles, so the
# SAME function shapes both answers. Arrays become {t:'arr', shape, kind, v}; kind is
# 'bool' when the elements are Python bools (the boolean-dtype question), else 'num'
# (integer vs float is deliberately not distinguished: line is float64 throughout).


def _kind(v):
    if isinstance(v, bool):
        return 'bool'
    if isinstance(v, (list, tuple)):
        for x in v:
            k = _kind(x)
            if k != 'empty':
                return k
        return 'empty'
    return 'num'


def _norm(v):
    if isinstance(v, bool):
        return {'t': 'bool', 'v': v}
    if isinstance(v, (int, float)):
        return {'t': 'num', 'v': float(v)}
    if isinstance(v, str):
        return {'t': 'str', 'v': v}
    if isinstance(v, (list, tuple)):
        return {'t': 'seq', 'v': [_norm(x) for x in v]}
    if hasattr(v, 'tolist') and hasattr(v, 'shape'):
        shape = list(v.shape)
        lst = v.tolist()
        if len(shape) == 0:
            return _norm(lst)
        return {'t': 'arr', 'shape': shape, 'kind': _kind(lst), 'v': lst}
    return {'t': 'other', 'v': str(v)}
