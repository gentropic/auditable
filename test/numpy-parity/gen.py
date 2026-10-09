# Record real numpy's answers for corpus.json → golden.json (committed, so the Node
# test needs no numpy). Run with the CPython that has numpy:  python test/numpy-parity/gen.py
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ns_norm = {}
exec(open(os.path.join(HERE, 'norm.py'), encoding='utf8').read(), ns_norm)
_norm = ns_norm['_norm']


def clean(o):
    # JSON has no NaN / Infinity: spell them as strings
    if isinstance(o, float):
        if math.isnan(o):
            return 'nan'
        if math.isinf(o):
            return 'inf' if o > 0 else '-inf'
        return o
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(x) for x in o]
    return o


corpus = json.load(open(os.path.join(HERE, 'corpus.json'), encoding='utf8'))
golden = {'numpy': np.__version__, 'cases': {}}
for case in corpus['cases']:
    ns = {'np': np}
    try:
        exec(case['code'], ns)
        golden['cases'][case['id']] = clean(_norm(ns['r']))
    except Exception as e:  # numpy itself refuses → the bridge raising is a match
        golden['cases'][case['id']] = {'t': 'error', 'v': type(e).__name__}

json.dump(golden, open(os.path.join(HERE, 'golden.json'), 'w', encoding='utf8', newline='\n'), indent=1, ensure_ascii=False)
print(f"golden.json: {len(golden['cases'])} cases from numpy {np.__version__}", file=sys.stderr)
