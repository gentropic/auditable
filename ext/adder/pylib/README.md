# adder pylib — the Python-source standard library

Modules written in Python, imported by adder programs like any other stdlib module (frozen
modules). `node ext/adder/gen-pylib.js` embeds every `.py` here into `src/stdlib-py.js`
(adder's `build.js` runs it first), gzip-compressed and decompressed on first import; they compile
on whichever engine the program runs on.

`pylib/<a>/<b>.py` is module `a.b`; `pylib/<a>/__init__.py` makes `a` a package. A file may
extend a JS-provided module as a submodule (`html/parser.py` under adder's own `html`).

| module | origin |
|---|---|
| `__adder__` (the compile-time flags + type-hint names; also the CPython stub); `xml`, `xml.etree`, `xml.etree.ElementTree`; `importlib._bootstrap`, `importlib._bootstrap_external` (the few names tools reach for, over adder's own import system) | adder's own (MIT, as the rest of adder) |
| `unittest` (+ `unittest.mock`), `doctest`, `difflib`, `argparse`, `bisect`, `dataclasses`, `heapq`, `getopt`, `glob`, `shutil`, `pkgutil`, `html.parser`, `_markupbase`, `_colorize`, `json` (over adder's JS `_json`, as CPython's over its C one), `collections` (over adder's JS `_collections`: `deque`, `defaultdict`, `OrderedDict`, as CPython's over its C one), `_collections_abc` (`collections.abc`, over adder's JS ABCMeta — CPython's `_abc` algorithm), `pydoc`, `token`, `tokenize`, `__future__`, `random` (over adder's JS `_random`, CPython's Mersenne Twister, as CPython's over its C one), `_pyrepl` (`__init__`, `pager`); `mimetypes`, `ipaddress`, `colorsys`, `graphlib`, `optparse`, `fileinput`, `filecmp`, `sched`, `secrets`, `timeit`, `tomllib` (`__init__`, `_parser`, `_re`, `_types`), `cmd`, `code`, `codeop`, `quopri`, `netrc`, `wave`, `runpy`, `shelve`, `pickletools`, `tarfile`, `tabnanny` | CPython 3.13 standard library, verbatim — PSF License 2.0, see `LICENSE-PSF.txt` (`_pyrepl/__init__.py` carries its own permissive notice) |
| `_tokenize` | adapted from CPython 3.11's pure-Python tokenizer loop (PSF License 2.0): the `TokenizerIter` 3.13's `tokenize.py` drives, where CPython has a C tokenizer |

Vendored CPython files are kept unmodified; when one needs a change for adder, fix adder
instead (the engines are meant to run CPython's own source).
