# Record CPython's answers for corpus.txt into golden.json (committed, so the Node side needs no
# Python). Run with any CPython 3.10+:  python test/python-parity/gen.py
# Each case: its stdout, and the type name of an uncaught exception (or null).
import contextlib
import io
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def cases(text):
    out, name, buf = [], None, []
    for line in text.split('\n'):
        if line.startswith('### '):
            if name:
                out.append((name, '\n'.join(buf).strip('\n') + '\n'))
            name, buf = line[4:].strip(), []
        elif name is not None:
            buf.append(line)
    if name:
        out.append((name, '\n'.join(buf).strip('\n') + '\n'))
    return out


golden = {'python': sys.version.split()[0], 'cases': {}}
for name, code in cases(open(os.path.join(HERE, 'corpus.txt'), encoding='utf8').read()):
    random.seed(0)
    buf, err = io.StringIO(), None
    with contextlib.redirect_stdout(buf):
        try:
            exec(compile(code, name, 'exec'), {'__name__': '__main__'})
        except BaseException as e:  # noqa: BLE001 - the type is the record
            err = type(e).__name__
    golden['cases'][name] = {'out': buf.getvalue(), 'error': err}

json.dump(golden, open(os.path.join(HERE, 'golden.json'), 'w', encoding='utf8', newline='\n'), indent=1, ensure_ascii=False)
print(f"golden.json: {len(golden['cases'])} cases from Python {golden['python']}", file=sys.stderr)
