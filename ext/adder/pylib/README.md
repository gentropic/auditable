# adder pylib — the Python-source standard library

Modules written in Python, imported by adder programs like any other stdlib module (frozen
modules). `node ext/adder/gen-pylib.js` embeds every `.py` here into `src/stdlib-py.js`
(adder's `build.js` runs it first), gzip-compressed and decompressed on first import; they compile
on whichever engine the program runs on.

`pylib/<a>/<b>.py` is module `a.b`; `pylib/<a>/__init__.py` makes `a` a package. A file may
extend a JS-provided module as a submodule (`html/parser.py` under adder's own `html`).

| module | origin |
|---|---|
| `xml`, `xml.etree`, `xml.etree.ElementTree` | adder's own (MIT, as the rest of adder) |
| `unittest` (+ `unittest.mock`), `doctest`, `difflib`, `argparse`, `bisect`, `dataclasses`, `heapq`, `getopt`, `glob`, `shutil`, `pkgutil`, `html.parser`, `_markupbase`, `_colorize` | CPython 3.13 standard library, verbatim — PSF License 2.0, see `LICENSE-PSF.txt` |

Vendored CPython files are kept unmodified; when one needs a change for adder, fix adder
instead (the engines are meant to run CPython's own source).
