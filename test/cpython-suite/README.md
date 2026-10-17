# CPython's test suite against adder

The yardstick for "is adder a Python": CPython's own `Lib/test`, run unmodified under adder and
compared with the same tests under the local CPython.

```
node test/cpython-suite/fetch.mjs                  # once: CPython's Lib/test at the local python's tag
node test/cpython-suite/drive.mjs --list=core      # the core-language modules (modules-core.txt)
node test/cpython-suite/drive.mjs test_dict test_set --engine=tree --timeout=300
```

Per module it prints `adder-passes/cpython-passes` — the tests CPython passes here (some are
platform-specific or skip on Windows) that adder passes too — and why a module stopped early
(`IMPORTERROR …`, `CRASH in <test>`, `TIMEOUT in <test>`). Per-test results land in
`results/<engine>/<module>.json`; CPython's are cached in `results/cpython/`.

How a module runs (`runner.py`): `test.<module>` is imported, its tests loaded with
`unittest.TestLoader().loadTestsFromModule` and run with a result class that prints one line per
test. A `load_tests` hook that fails (typically: doctests of a stdlib module adder implements in
JS, which doctest can't introspect) is recorded as one error and the module's ordinary tests are
loaded without it. Each module gets a staged `test` package: `test/__init__`, `test/support`, the
helper modules (`list_tests`, `seq_tests`, …) and the module itself.

Not part of `npm test` (a full run takes a while); the tests and results are gitignored.
