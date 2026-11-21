# CPython's own formatting, for plot's src/pyfmt.js (test/plot-tier2.test.mjs). Any Python 3:
#   python test/fixtures/plot-pyfmt.py
import json, pathlib
cases_spec = [
    (1234567.891, ',.0f'), (1234567.891, ',.2f'), (0.0456, '.1%'), (0.5, '%'), (3.14159, '.3g'),
    (1e-5, 'g'), (123456789.0, 'g'), (1e16, 'g'), (0.0001, 'g'), (100.0, '.2g'), (9.99, '.2g'),
    (42.0, '>8.1f'), (42.0, '<8.1f'), (42.0, '^9.1f'), (-42.0, '08.2f'), (42.0, '+.1f'), (42.0, ' .1f'),
    (1234.5, '_.1f'), (255.0, 'x'), (255.0, 'X'), (8.0, 'o'), (5.0, 'b'), (12345.678, 'e'), (12345.678, '.2E'),
    (2.5, ''), (1.0, ''), (1e-05, ''), (3.14159, '.3'), (2.0, '.3'), (0.0, 'g'), (-0.0, '.1f'), (1234.0, ',d'),
    (0.1 + 0.2, ''), (1.5e20, ''), (2.5, '#g'), (100.0, '.0f'), (2.675, '.2f'),
]
def spec_out(v, s):
    if s and s[-1] in 'dxXob':
        return format(int(round(v)), s)
    return format(v, s)
out = {'spec': [[v, s, spec_out(v, s)] for v, s in cases_spec]}
cases_tpl = [('{x:,.0f} m', {'x': 1234.5}), ('{x:.1f}°', {'x': 12.345}), ('{x}', {'x': 3.0}), ('{pos}: {x:.2f}', {'x': 1.5, 'pos': 2}), ('{{x}} {x:g}', {'x': 0.25})]
out['tpl'] = [[t, n, t.format(**n)] for t, n in cases_tpl]
cases_pct = [('%.2f', 3.14159), ('%d', 2.7), ('%d', -2.7), ('%5.1f', 3.14159), ('%-6.1f|', 3.14159), ('%e', 12345.678), ('%g', 0.0001), ('%s', 1.0), ('%s', 2.5), ('%+.1f', 2.0), ('%05.1f', 3.14159), ('%.0f%%', 45.0), ('%i', 7.9), ('%x', 255)]
out['pct'] = [[f, v, f % v] for f, v in cases_pct]
pathlib.Path(__file__).with_name('plot-pyfmt.json').write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
print('wrote plot-pyfmt.json')
