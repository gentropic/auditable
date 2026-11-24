// @gcu/scan sources — the units a model is read in, and how the page reads one
// (the workers read the same unit their own way, from `desc` — worker.js).
// D = the injected libraries { parquet, condenser }.
//
// A source: { names, file, meta, desc, units: [{ start, count, run?, rg? }],
//             read(unit) → { [column]: values }, zones? }
// Three kinds, one engine:
//   parquet — a row group per unit; the footer entry rides as unit.rg (pushdown)
//   dm      — a Datamine .dm's page RUNS (condenser dmPageRuns / readDmRun:
//             ~4 MB of fixed-size pages, only the needed fields decoded by
//             striding)
//   csv     — a delimited model's runs (condenser delimitedRuns /
//             readDelimitedRun): the open's sparse index marks the byte start of
//             every 1024th accepted record, so a run starts at a record (quote
//             state clean) whose number is known; consecutive KEPT zones only
//             (keep(z) false → that zone's bytes are never read)
// All three number every record from 0, so a unit's start is its first record.

export function parquetSource(D, P, readCols) {
  const starts = []; let a = 0; for (const rg of P.rowGroups) { starts.push(a); a += rg.rowCount; }
  return {
    names: P.names, file: P.buf, meta: P.meta, desc: { kind: 'parquet' },
    units: P.rowGroups.map((rg, g) => ({ start: starts[g], count: rg.rowCount, rg })),
    read: (u) => D.parquet.readParquetRange(P.buf, readCols, u.start, u.start + u.count, P.meta),
  };
}

// h = the delimited header (columns, delim, index, zones); o = the run reader's
// options { delim, x, y, z, cols: [{ i, num, policy }] } — each column read as
// the row path reads it (qualifier substitutes; numbers as the pin cache holds them)
export function delimitedSource(D, blob, h, o, readCols, { anchors = 64, keep = null } = {}) {
  return {
    names: h.columns, file: blob, meta: null, desc: { kind: 'csv', o }, zones: keep ? h.zones : null,
    units: D.condenser.delimitedRuns(h, blob.size, anchors, keep).map((run) => ({ start: run.start, count: run.count, run })),
    read: async (u) => { const r = await D.condenser.readDelimitedRun(blob, u.run, o); const out = {}; readCols.forEach((n, k) => { out[n] = r[k]; }); return out; },
  };
}

// dmh = the .dm header (condenser), names = the model's columns; place = the
// model's placement (condenser header.dmPlace: a rotated model's XC/YC/ZC come
// back in WORLD) — carried in desc, so the workers place exactly as the page does
export function dmSource(D, blob, dmh, names, readCols, { place = null } = {}) {
  const idx = readCols.map((n) => names.indexOf(n));
  return {
    names, file: blob, meta: null, desc: { kind: 'dm', h: dmh, idx, place },
    units: D.condenser.dmPageRuns(dmh).map((run) => ({ start: run.start, count: run.count, run })),
    read: async (u) => { const r = await D.condenser.readDmRun(blob, dmh, idx, u.run, place); const out = {}; readCols.forEach((n, k) => { out[n] = r.cols[idx[k]]; }); return out; },
  };
}
