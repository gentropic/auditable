// micro lineage — the provenance a derived thing carries (op · params · sources · build · at),
// and micro:model, a block model's discovery as the Parquet kv a micro-written file
// self-describes with. Carved from index.html (phase 3).
import { basisOfGrid } from '../../../ext/condenser/src/main.js';
// the app's side, passed in once (setLineageHooks): __MICRO_BUILD__
let H = {};
export function setLineageHooks(h) { H = h; }

// provenance: every layer carries a lineage tree — how it was made. Opened
// files are leaves (op:'open'); derived ops (join/reconcile/optimize/keyjoin/
// grid) wrap their sources. Embedded in Parquet exports (kvMetadata) + persisted
// in the project; the inspector + report render it. Date.now is fine here (app,
// not a workflow script).
export function mkLineage(op, params, sources) { return { op, at: Date.now(), build: H.__MICRO_BUILD__, params: params || {}, sources: (sources || []).filter(Boolean) }; }

export function openLineage(name, blob) { return { op: 'open', at: Date.now(), build: H.__MICRO_BUILD__, params: {}, origin: { file: name, bytes: (blob && blob.size) || 0 }, sources: [] }; }

// `micro:model` — the discovery a block-model Parquet carries in its footer kv,
// so it opens without a discovery sweep. Written by micro's exports and read
// from ANY Parquet file: a producer that knows its lattice may write it too.
// The contract is in docs/index.html (#micro-model). Size columns ride as
// NAMES (`dims`), never indices — a producer's column order is its own business.
export function microModelOf(h) {
  const m = { v: 1, grid: h.grid || null, bbox: h.bbox, categories: h.categories || null, subBlocked: !!h.subBlocked };
  // the labels belong to ONE column: say which, or a re-map to another category
  // column would read these labels as its own
  if (h.categories && h.mapping && h.mapping.cat != null && h.columns) m.catColumn = h.columns[h.mapping.cat];
  // a rotated lattice also states itself in the producer's form (grid.basis:
  // origin = block 0's centroid, U/V/W = pitch × direction) beside the internal
  // rot/anchor, so the file reads the same to micro and to anyone else
  if (h.grid && h.grid.rot) m.grid = { ...h.grid, basis: basisOfGrid(h.grid) };
  if (h.lattice) m.lattice = h.lattice;
  if (h.subBlocked && h.dimCols && h.dimPalette && h.columns) {
    m.dims = { x: h.columns[h.dimCols.x], y: h.columns[h.dimCols.y], z: h.columns[h.dimCols.z] };
    m.dimPalette = h.dimPalette;
  }
  return m;
}
