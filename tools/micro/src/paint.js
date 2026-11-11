// micro — paint-to-column (§15): interactive domaining. A painted column is
// per-record u8 codes + a value dict, filled by the selection gestures while a
// brush value is armed.

// the brush, shared with the selection tool (its gestures paint while a brush is armed)
export const PAINT = {
  arm: null,          // { lid, colName, code } — ONE armed brush globally
  lastKind: 'rect',   // the gesture shape the brush last used
  lastLid: null,      // the layer painted LAST (Ctrl+Z falls back to it)
};
