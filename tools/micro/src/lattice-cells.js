// micro LATTICE CELLS — a block model's records as boxes on its FINE lattice, the one read that
// section lines (domain boundaries) and bench outlines share. Each block becomes
//   { lo: [i, j, k], size: [ni, nj, nk], rec, cat, vol, w }
// in fine steps of the support contract (ext/condenser/src/grid/support.js): a regular model's
// block is one step; a sub-block is its stated size snapped to whole steps (halfAt); a rotated
// model's indices are in its LATTICE frame (q = Rᵀ(p − anchor)), so the caller works in the
// lattice and maps back to world through `lattice` (R, anchor) at the end.
import { layerRecords, layerTableHeader, schemaExt, numOf } from './records.js';
import { volumeContextOf, halfAt, volumeAt } from './analysis.js';
import { gridAxesOf } from './grid-ops.js';
import { ensureStoredValues, expandedDeps } from './columns.js';
import { supportOfHeader, supportToLattice } from '../../../ext/condenser/src/main.js';
import { compileBool, compileValue, parse, quoteIdent } from '../../../ext/expr/index.js';

const nameOf = (L) => (L ? L.label || L.name : '?');

// the lattice of a block layer: { pitch, originQ, R, anchor, count, sizeQMax, rotated } or null
export function latticeOf(L) {
  const h = L && L.docs && L.docs.blockDoc && L.docs.blockDoc.header;
  if (!h || !gridAxesOf(L)) return null;
  const sup = supportOfHeader(h);
  if (!sup) return null;
  return { pitch: sup.lattice.pitch.map((p) => Math.abs(+p) || 1), originQ: sup.lattice.originQ.slice(), R: sup.frame.R.slice(), anchor: sup.frame.anchor.slice(), count: sup.lattice.count.slice(), sizeQMax: (sup.sizeQMax || [1, 1, 1]).map((q) => Math.max(1, Math.round(q || 1))), rotated: !!sup.frame.rotated, sub: !!sup.sub, frame: sup.frame };
}

// the layer's category column by default: its mapped category, else the colour-by when that is a text column
export function defaultCategoryColumn(L) {
  const h = layerTableHeader(L);
  if (!h) return null;
  if (h.mapping && h.mapping.cat != null && h.columns[h.mapping.cat] != null) return h.columns[h.mapping.cat];
  const sel = String(L.colorSel || '');
  if (sel.startsWith('catcol:')) return sel.slice(7);
  return null;
}

/**
 * The blocks of a block layer on its fine lattice.
 * opts: mask (Uint8Array by record, e.g. the selection), where (an expression over the row),
 * column (a category column — `cat` on each block), density (a number or a column / expression —
 * `w` = volume × density on each block), signal.
 * → { blocks, lattice, column, total }
 */
export async function latticeCells(L, { mask = null, where = null, column = null, density = null, signal = null, onProgress = null } = {}) {
  const lat = latticeOf(L);
  if (!lat) throw new Error(`${nameOf(L)} is not a block model on a lattice`);
  const h = layerTableHeader(L), m = h && h.mapping;
  if (!m || m.x == null) throw new Error(`${nameOf(L)} has no coordinate columns`);
  const schema = schemaExt(L, h);
  let ci = -1;
  if (column != null && column !== '') {
    ci = schema.findIndex((c) => c.name === column);
    if (ci < 0) ci = schema.findIndex((c) => String(c.name).toLowerCase() === String(column).toLowerCase());
    if (ci < 0) throw new Error(`${nameOf(L)}: no column “${column}” (columns: ${schema.map((c) => c.name).slice(0, 12).join(', ')}${schema.length > 12 ? ', …' : ''})`);
  }
  const needs = new Set();
  if (ci >= 0) needs.add(String(schema[ci].name).toLowerCase());
  let whereFn = null;
  if (where != null && String(where).trim()) {
    try { whereFn = compileBool(String(where), schema, { decimal: '.' }); } catch (e) { throw new Error(`where “${where}”: ${e.message}`); }
    try { for (const d of expandedDeps(L, parse(String(where)))) needs.add(d); } catch { /* compiled above */ }
  }
  let densFn = null, densConst = null;
  if (density != null && density !== '') {
    if (typeof density === 'number' || Number.isFinite(+density)) densConst = +density;
    else {
      const exprText = schema.some((c) => c.name === density) ? quoteIdent(density) : String(density);
      try { densFn = compileValue(exprText, schema, { decimal: '.' }); } catch (e) { throw new Error(`density “${density}”: ${e.message}`); }
      needs.add(String(density).toLowerCase());
    }
  }
  if (needs.size) await ensureStoredValues(L, needs);
  const vc = volumeContextOf(L), half = [0, 0, 0], q = [0, 0, 0];
  // the fine lattice's CORNER phase, from the data: the first block's low corner. (originQ is the
  // centre of a fine cell by the contract, but where a model's sizes are all even steps — a
  // sub-blocked model whose fine pitch is half its smallest block — that centre is half a step off
  // the blocks' own corners; the blocks are the truth.)
  const P = lat.pitch;
  let c0 = null;
  const blocks = [];
  let total = 0, n = 0;
  for await (const { f, rec } of layerRecords(L)) {
    if ((++n & 0xffff) === 0) { if (signal && signal.aborted) throw new DOMException('cancelled', 'AbortError'); if (onProgress) onProgress(n); await new Promise((r) => setTimeout(r)); }
    if (mask && !(rec < mask.length && mask[rec])) continue;
    if (whereFn && !whereFn(f)) continue;
    const x = numOf(f[m.x]), y = numOf(f[m.y]), z = numOf(f[m.z]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    halfAt(vc, f, half);
    supportToLattice(lat.frame, x, y, z, q);
    if (!c0) c0 = [0, 1, 2].map((a) => q[a] - half[a]);
    const lo = [0, 1, 2].map((a) => Math.round((q[a] - half[a] - c0[a]) / P[a]));
    const size = [0, 1, 2].map((a) => Math.max(1, Math.round((2 * half[a]) / P[a])));
    const vol = volumeAt(vc, f);
    let w = vol;
    if (densConst != null) w = vol * densConst;
    else if (densFn) { const dv = +densFn(f); w = Number.isFinite(dv) ? vol * dv : 0; }
    blocks.push({ lo, size, rec, cat: ci >= 0 ? (f[ci] == null ? '' : f[ci]) : null, vol, w });
    total++;
  }
  if (c0) lat.originQ = c0.map((c, a) => c + P[a] / 2);  // the cells' frame: node (0,0,0) is the first block's low corner
  return { blocks, lattice: lat, column: ci >= 0 ? schema[ci].name : null, total, density: densConst != null ? densConst : densFn ? String(density) : null };
}
