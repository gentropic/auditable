// adder — ES module entry point (import order doubles as build manifest)
import './parse.js';
import './ast-cpython.js';   // CPython's ast trees from the parser (compile(…, PyCF_ONLY_AST))
import './builtins.js';
import './eval.js';
import './runtime.js';
import './stdlib.js';
import './stdlib-types.js';
import './stdlib-num.js';
import './stdlib-cmath.js';
import './stdlib-array.js';
import './stdlib-json.js';
import './stdlib-time.js';
import './stdlib-data.js';
import './stdlib-sys.js';
import './stdlib-pickle.js';
import './stdlib-net.js';
import './stdlib-py.js';   // GENERATED from pylib/ by gen-pylib.js
import './stdlib-pyair.js';   // GENERATED (the precompiled hot set) by gen-pyair.js
import './runner.js';   // run / evalExpr / compile / isIncomplete — the library API, sandbox options included
import './highlight.js';
import './air-lower.js';
import './cell.js';
import './tag.js';
export { adder } from './register.js';
