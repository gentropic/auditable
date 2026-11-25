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

// A model's PLACEMENT for the parquet and delimited sources (a .dm carries its own,
// index-based, in readDmRun): { cols: [xName, yName, zName], dims?: [dxName, dyName, dzName],
// R (3×3 column-major, the scale folded in), O: [3], s }. world = O + R·file; the size columns
// scale by s. Applied to the decoded columns of a unit, page and worker alike (desc.place),
// into FRESH Float64Arrays (a column may decode as Int32 / BigInt). A record missing any of
// the three coordinates keeps NaN — it has no position.
export function placeNamedCols(place, cols, count) {
  if (!place || !cols) return cols;
  const [xn, yn, zn] = place.cols, X = cols[xn], Y = cols[yn], Z = cols[zn];
  if (X && Y && Z) {
    const R = place.R, O = place.O, ox = new Float64Array(count), oy = new Float64Array(count), oz = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      const x = Number(X[k]), y = Number(Y[k]), z = Number(Z[k]);
      if (X[k] == null || X[k] === '' || Y[k] == null || Y[k] === '' || Z[k] == null || Z[k] === '' || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ox[k] = oy[k] = oz[k] = NaN; continue; }
      ox[k] = O[0] + R[0] * x + R[3] * y + R[6] * z;
      oy[k] = O[1] + R[1] * x + R[4] * y + R[7] * z;
      oz[k] = O[2] + R[2] * x + R[5] * y + R[8] * z;
    }
    cols[xn] = ox; cols[yn] = oy; cols[zn] = oz;
  }
  if (place.dims && place.s !== 1) for (const dn of place.dims) {
    const D = cols[dn]; if (!D) continue;
    const o = new Float64Array(count);
    for (let k = 0; k < count; k++) { const v = D[k] == null || D[k] === '' ? NaN : Number(D[k]); o[k] = v * place.s; }
    cols[dn] = o;
  }
  return cols;
}

export function parquetSource(D, P, readCols, { place = null } = {}) {
  const starts = []; let a = 0; for (const rg of P.rowGroups) { starts.push(a); a += rg.rowCount; }
  return {
    names: P.names, file: P.buf, meta: P.meta, desc: { kind: 'parquet', place },
    units: P.rowGroups.map((rg, g) => ({ start: starts[g], count: rg.rowCount, rg })),
    read: async (u) => placeNamedCols(place, await D.parquet.readParquetRange(P.buf, readCols, u.start, u.start + u.count, P.meta), u.count),
  };
}

// h = the delimited header (columns, delim, index, zones); o = the run reader's
// options { delim, x, y, z, cols: [{ i, num, policy }] } — each column read as
// the row path reads it (qualifier substitutes; numbers as the pin cache holds them)
export function delimitedSource(D, blob, h, o, readCols, { anchors = 64, keep = null, place = null } = {}) {
  return {
    names: h.columns, file: blob, meta: null, desc: { kind: 'csv', o, place }, zones: keep ? h.zones : null,
    units: D.condenser.delimitedRuns(h, blob.size, anchors, keep).map((run) => ({ start: run.start, count: run.count, run })),
    read: async (u) => { const r = await D.condenser.readDelimitedRun(blob, u.run, o); const out = {}; readCols.forEach((n, k) => { out[n] = r[k]; }); return placeNamedCols(place, out, u.count); },
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
