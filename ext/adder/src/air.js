// @gcu/adder/air — AIR-powered runtime API.
// Same shape as the tree-walker API in @gcu/adder, but transpiles adder source
// to V8-hinted JavaScript via @gcu/air before execution (15-300x faster for
// numeric work, often 2-50x for general code).
//
// A thin layer over runner.js's engine 'air': one compile path and ONE sandbox
// for both entry points, so host / remote / budget hold here exactly as in
// run(code, { engine: 'air' }). The budget counts statements through _py.tick;
// budget.onStep (a trace) needs the tree-walker and is refused.
//
// Requires @gcu/air as a peer dependency: loaded on first use and attached, or
// handed in beforehand with attachAir(air) (a worker host, a bundle).

import { adderParse } from './parse.js';
import {
  run as _run, isIncomplete, AdderRuntimeError, attachAir, airAttached,
  _airCompile, _airCall, _makeBindingsForAir,
} from './runner.js';

async function _ensureAir() {
  if (airAttached()) return;
  let air;
  try { air = await import('@gcu/air'); } catch (e) {
    throw new Error(
      '@gcu/adder/air requires @gcu/air as a peer dependency.\n' +
      'Install with: npm install @gcu/air (or call attachAir(air) first)'
    );
  }
  attachAir(air);
}

// Strip common leading whitespace — same rationale as @gcu/adder's runner.js.
function _dedent(code) {
  if (typeof code !== 'string' || code.indexOf('\n') === -1) return code;
  const lines = code.split('\n');
  let min = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^[ \t]*/);
    const n = m ? m[0].length : 0;
    if (n < min) min = n;
    if (min === 0) break;
  }
  if (!Number.isFinite(min) || min === 0) return code;
  return lines.map(l => l.slice(min)).join('\n');
}

/**
 * Execute adder source as a module. Returns the resulting scope as a plain object
 * mapping bound names to values.
 *
 * @param {string} code - adder source code
 * @param {object} [opts] - see @gcu/adder run() for the full option shape
 * @returns {Promise<Record<string, any>>} the module scope
 */
export async function run(code, opts = {}) {
  await _ensureAir();
  return _run(code, { ...opts, engine: 'air' });
}

/**
 * Evaluate a single adder expression and return its value.
 *
 * @param {string} code - adder expression (not a statement)
 * @param {object} [opts] - see @gcu/adder run() for the full option shape
 * @returns {Promise<any>} the expression value
 */
export async function evalExpr(code, opts = {}) {
  // Wrap the expression as an assignment so the emitted code captures the value,
  // then pluck it from the returned scope.
  const scope = await run(`__adder_expr_result = (${_dedent(code).trim()})`, opts);
  return scope?.__adder_expr_result;
}

/**
 * Compile once, run many. Compilation includes AIR lowering, passes, and JS
 * emission — amortize the cost by caching the compiled function. Compiled with
 * budget ticks, so a run() given a budget honours it; without one they are no-ops.
 *
 * @param {string} code - adder source code
 * @returns {Promise<{ air: object, imports: string[], run(opts?): Promise<Record<string, any>> }>}
 */
export async function compile(code) {
  await _ensureAir();
  const src = _dedent(code);
  const compiled = _airCompile(adderParse(src), src, true);
  return {
    air: compiled.air,
    imports: compiled.imports.slice(),
    async run(opts = {}) {
      if (opts.budget && typeof opts.budget.onStep === 'function') {
        throw new AdderRuntimeError('budget.onStep needs the tree-walker: compiled code has no interpreter frames');
      }
      return await _airCall(compiled, opts, _makeBindingsForAir(opts));
    },
  };
}

export { isIncomplete, AdderRuntimeError, attachAir };
