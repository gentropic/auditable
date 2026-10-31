// micro chunkview — THE view of a chunk of records that every expression sees:
// the base columns by name, then the stored derived columns (painted labels /
// ratio fractions / materialized values), then the calc columns evaluated in
// dependency order. Positions follow schemaExt (base · paint · calc).
//
// ZERO imports on purpose: the page uses it (columns.js censusChunkCols) and so do
// the scan workers (src/pqpool.js), and a module worker has no import map, so
// anything it imports must arrive by URL. What it needs (@gcu/expr's compileChunk)
// is passed in. One definition on both sides — the semantics can't drift apart.

// spec: { base: [name…], paints: [{ name, kind, mat, dict, need }] } — paints in
// L.paintCols order; `need` false skips the column (left null, as the census did).
// page: per paint index, the chunk's slice — Uint8 codes, or the materialized
// Float32 values (null = evicted → blank). calcFns: [{ slot, fn }] from compileCalcs.
export function chunkView(spec, baseByName, page, n, calcFns) {
  const base = spec.base, pcs = spec.paints;
  const out = new Array(base.length + pcs.length + (spec.calcCount || 0)).fill(null);
  for (let i = 0; i < base.length; i++) { const c = baseByName[base[i]]; if (c) out[i] = c; }
  for (let j = 0; j < pcs.length; j++) {
    const pc = pcs[j];
    if (!pc.need) continue;
    const src = page[j];
    if (pc.mat) { out[base.length + j] = src || null; continue; }
    const a = new Array(n);
    if (!src) { a.fill(pc.kind === 'ratio' ? 0 : ''); out[base.length + j] = a; continue; }
    for (let i = 0; i < n; i++) { const code = src[i] || 0; a[i] = pc.kind === 'ratio' ? +(code / 255).toFixed(3) : ((code && pc.dict[code]) || ''); }
    out[base.length + j] = a;
  }
  if (calcFns) for (const { slot, fn } of calcFns) { const { buf } = fn(out, n); out[slot] = buf; }
  return out;
}

// calcs: [{ slot, expr }] in dependency order (calcOrder) → [{ slot, fn }]. A calc
// that won't compile reads blank, as everywhere.
export function compileCalcs(E, calcs, schema) {
  return calcs.map(({ slot, expr }) => {
    let fn; try { fn = E.compileChunk(expr, schema, { decimal: '.' }); } catch { fn = () => ({ t: 'raw', buf: [] }); }
    return { slot, fn };
  });
}

// a chunk result as numbers for the analyses: compileChunk hands back a Float64
// buffer (blank = NaN) or raw values, where a blank is '' or null — MISSING, never
// 0 (unary plus would say 0). Same rule as records.js numOf.
export function chunkNumbers(r, n, out) {
  const buf = r.buf;
  if (buf instanceof Float64Array) return buf;
  const o = out && out.length >= n ? out : new Float64Array(n);
  if (r.t === 'bool' && ArrayBuffer.isView(buf)) {         // 0 / 1, and 2 = blank
    for (let i = 0; i < n; i++) o[i] = buf[i] === 2 ? NaN : buf[i];
    return o;
  }
  for (let i = 0; i < n; i++) {
    const v = buf[i];
    o[i] = typeof v === 'number' ? v : v == null || (typeof v === 'string' && v.trim() === '') ? NaN : +v;   // true → 1, false → 0, as numOf
  }
  return o;
}
