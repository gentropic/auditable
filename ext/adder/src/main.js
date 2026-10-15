// adder — ES module entry point (import order doubles as build manifest)
import './parse.js';
import './builtins.js';
import './eval.js';
import './runtime.js';
import './stdlib.js';
import './stdlib-types.js';
import './stdlib-num.js';
import './stdlib-time.js';
import './stdlib-data.js';
import './runner.js';   // run / evalExpr / compile / isIncomplete — the library API, sandbox options included
import './highlight.js';
import './air-lower.js';
import './cell.js';
import './tag.js';
export { adder } from './register.js';
