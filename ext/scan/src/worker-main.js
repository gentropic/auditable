// @gcu/scan — the worker bundle's entry (worker.js at the package root): what a
// pool worker imports. Zero static imports beyond this package's own code.
export { serve } from './worker.js';
