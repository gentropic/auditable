// @gcu/stereonet — module manifest (build order). One package, the GCU stack's stereonet:
//   format.js — attitudes as text (planes 045/72, lines 045→32)
//   core.js   — stereonetCore(bearing): layers → scene (primitives + statistics) → a bearing net, picking
//   select.js — selections in attitude space (cone, band, lasso polygon): rotation-proof, axial
//   cell.js   — the notebook's `/// stereonet` cell (registers itself in a notebook)
// No static imports anywhere: bearing is injected (core) or loaded at run time (cell).

export * from './format.js';
export * from './core.js';
export * from './select.js';
export * from './cell.js';
