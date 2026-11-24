// @gcu/condenser — `micro:model`, a block model's lattice stated by the file that
// carries it. Parquet puts it in the footer kv (key `micro:model`); a delimited file
// puts it in a COMMENT LINE at the top:
//
//   # micro:model {"v":1,"by":"micro","grid":{…},"subBlocked":true,"dims":{"x":"XINC",…},…}
//   XC,YC,ZC,XINC,YINC,ZINC,V
//   …
//
// One line, `#` first, before the header row — a reader that skips comment lines
// (pandas `comment='#'`, R `comment.char`, micro's own) sees an ordinary CSV. The
// JSON is the same object the Parquet kv carries (micro's microModelOf writes both).
// A reader that finds it applies the grid as a DECLARED lattice: every centroid is
// checked against it (latticeMisfit), and one off it refuses the declaration — the
// model shows as points and says why. Nothing in it is trusted unchecked.
//
// Pure: no I/O, no DOM. The grid forms accepted are grid/basis.js's.

import { gridFromBasis } from './basis.js';
import { SIZEQ_MAX } from './support.js';

export const MICRO_MODEL_KEY = 'micro:model';
const LINE_RE = /^#\s*micro:model(?:\s+(.*?))?\s*$/;     // a line that says micro:model IS the statement (malformed → said)

/** The comment line for a micro:model object (no line ending). */
export function microModelLine(model) {
  return '# micro:model ' + JSON.stringify(model);
}

/**
 * The micro:model a delimited text states in its leading comment lines, or null.
 * Only the comment block at the top is looked at (blank lines and `#` lines, up to
 * the first data/header line). → { model } | { error } | null (none stated).
 */
export function parseMicroModelComment(text) {
  if (typeof text !== 'string') return null;
  let at = 0;
  while (at < text.length) {
    let e = text.indexOf('\n', at); if (e < 0) e = text.length;
    let l = text.slice(at, e); at = e + 1;
    if (l.endsWith('\r')) l = l.slice(0, -1);
    if (!l.trim()) continue;
    if (l[0] !== '#') return null;
    const m = LINE_RE.exec(l);
    if (!m) continue;
    try {
      const o = JSON.parse(m[1] || '');
      return o && typeof o === 'object' && !Array.isArray(o) ? { model: o } : { error: 'the # micro:model line is not a JSON object' };
    } catch (err) { return { error: `the # micro:model line is not valid JSON (${err.message})` }; }
  }
  return null;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const axisOk = (a) => a && finite(a.origin) && finite(a.pitch) && a.pitch >= 0 && Number.isInteger(a.count) && a.count >= 1;

/**
 * micro:model's grid → the internal grid ({ x, y, z } axes, + rot/anchor when
 * rotated), or null when it states none. Forms: per-axis { x, y, z } (axis-aligned),
 * the internal rotated form (+ rot, anchor), or a producer's { basis: { origin, U, V,
 * W, counts } } alone. Throws (with the reason) on a malformed grid.
 */
export function gridOfMicroModel(m) {
  const g = m && m.grid;
  if (!g) return null;
  if (g.rot && g.anchor && g.x) {
    if (![g.x, g.y, g.z].every(axisOk)) throw new Error('grid axes need origin, pitch and count');
    if (!Array.isArray(g.rot) || g.rot.length !== 9 || !g.rot.every(finite) || !Array.isArray(g.anchor) || g.anchor.length !== 3 || !g.anchor.every(finite)) throw new Error('a rotated grid needs rot (9 numbers) and anchor (3)');
    return { x: { ...g.x }, y: { ...g.y }, z: { ...g.z }, rot: [...g.rot], anchor: [...g.anchor], ...(g.source ? { source: g.source } : {}) };
  }
  if (g.basis) return gridFromBasis(g.basis);
  if (g.x) {
    if (![g.x, g.y, g.z].every(axisOk)) throw new Error('grid axes need origin, pitch and count');
    return { x: { ...g.x }, y: { ...g.y }, z: { ...g.z } };
  }
  return null;
}

/** micro:model `dims` (size columns by NAME) → indices in `names`, or null if absent / not all present. */
export function dimColsOfMicroModel(m, names) {
  if (!m || !m.dims || !names) return null;
  const at = (n) => names.findIndex((h) => String(h).trim() === n);
  const d = { x: at(m.dims.x), y: at(m.dims.y), z: at(m.dims.z) };
  return d.x >= 0 && d.y >= 0 && d.z >= 0 ? d : null;
}

/**
 * A DECLARED sub-block lattice checked against the sizes a discovery sweep saw (a
 * sizeCollector): every distinct size a whole number of fine steps, none past 255.
 * → { sizeQMax: [3], shapes } | { refused: reason }.
 */
export function declaredSubBlocks(sizes, pitch) {
  if (!sizes || !sizes.count) return { refused: 'the size columns hold no positive sizes' };
  const sizeQMax = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    for (const v of sizes.axes[a]) {
      const q = v / pitch[a];
      if (!(pitch[a] > 0) || Math.abs(q - Math.round(q)) > 1e-3) return { refused: `a ${'XYZ'[a]} size of ${v} is not a whole number of the declared fine step ${pitch[a]}` };
      if (Math.round(q) > SIZEQ_MAX) return { refused: `a ${'XYZ'[a]} size of ${v} spans ${Math.round(q)} fine steps, past the ${SIZEQ_MAX} a block can` };
      if (Math.round(q) > sizeQMax[a]) sizeQMax[a] = Math.round(q);
    }
  }
  return { sizeQMax, shapes: sizes.shapes };
}
