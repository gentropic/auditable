// Apache Parquet as a lamina source — the third binary table beside .dm and
// .xlsx, mounted the same way: a windowed browse view + a record cursor, no
// CSV in the middle and nothing decoded whole.
//
// - The SCHEMA comes from the footer: a column is numeric because the file says
//   so, never because a string parsed.
// - The BROWSE view reads 256-row blocks (every column in one decode call) into a
//   small LRU. A screenful deep inside a million-row row group costs ~60–85 ms.
// - The CURSOR (filter / sort / stats / export) walks row groups in ≤64K-row
//   slices, reading only the columns a predicate needs (`cols`), and skips a whole
//   row group when its footer min/max prove nothing in it can match (`prune`).
// - readByLoc (a filtered / sorted result view) shares the browse view's blocks,
//   so a run of matches costs one block read, not one per row.
//
// Limits, said out loud: SNAPPY / GZIP / ZSTD / uncompressed (LZ4 and BROTLI are
// refused by name — lamina stays WASM-free); flat columns only (a struct / list
// / map column is left out, and the format facts say which).

import { parquetInfoAsync, parquetFields, readParquetRows } from '@gcu/parquet';
import { LOADING } from '@gcu/lamina';

const READABLE = new Set(['UNCOMPRESSED', 'SNAPPY', 'GZIP', 'ZSTD']);

// PAR1 at both ends — the head alone isn't enough (a text file can start with it)
export function looksParquet(head, tail) {
  const m = (b) => b && b.length >= 4 && b[0] === 0x50 && b[1] === 0x41 && b[2] === 0x52 && b[3] === 0x31;
  return m(head) && m(tail);
}

// a File / Blob (or the lead-acid shell's Blob-shaped fileBlob) → hyparquet's
// AsyncBuffer: range reads through slice(), the file is never pulled in whole
export function fileBuffer(file) {
  return { byteLength: file.size, slice: (s, e) => file.slice(s, e == null ? file.size : e).arrayBuffer() };
}

// the footer → the table lamina mounts. Throws with a message a person can act on.
export async function openParquetTable(buf) {
  const info = await parquetInfoAsync(buf);
  const all = parquetFields(info.meta);
  const fields = all.filter((f) => !f.nested);
  const nested = all.filter((f) => f.nested).map((f) => f.name);
  if (!fields.length) throw new Error(`every column is nested (${nested.join(', ')}) — lamina shows flat tables`);
  const bad = new Set();
  for (const rg of info.meta.row_groups || []) for (const ch of rg.columns || []) {
    const cd = ch.meta_data && ch.meta_data.codec;
    if (cd && !READABLE.has(cd)) bad.add(cd);
  }
  if (bad.size) throw new Error(`compressed with ${[...bad].join(', ')} — lamina reads Snappy, gzip, zstd or uncompressed Parquet`);
  const schema = fields.map((f) => ({ name: f.name, type: f.kind === 'number' ? 'number' : 'string' }));
  return {
    info, fields, schema, nested,
    rowCount: info.rowCount,
    rowGroups: info.rowGroups,
    codec: info.codec,
    facts: [
      ['format', 'Apache Parquet'],
      ['columns', String(fields.length)],
      ['row groups', String(info.rowGroups.length)],
      ['compression', String(info.codec || 'none').toLowerCase()],
      ...(nested.length ? [['left out (nested)', nested.join(', ')]] : []),
    ],
  };
}

// one value → what a cell shows / what a scan compares. Numbers stay numbers in
// a scan (exact); everything else reads as its text.
function rawOf(v) {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return dateText(v);
  if (v instanceof Uint8Array) return hexText(v);
  if (typeof v === 'bigint') return v.toString();
  try { return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)); } catch { return String(v); }
}
const dispOf = (v) => { const r = rawOf(v); return r == null ? '' : String(r); };
function dateText(d) {
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('.000Z', 'Z');
}
function hexText(b) {
  let s = '0x';
  for (let i = 0; i < Math.min(b.length, 32); i++) s += b[i].toString(16).padStart(2, '0');
  return b.length > 32 ? s + '…' : s;
}

// The view source + the cursor over one Parquet table. They share a block cache.
export function createParquetSource(buf, t, { blockSize = 256, cacheBlocks = 16, slice = 65536 } = {}) {
  const K = blockSize, n = t.rowCount, names = t.fields.map((f) => f.name), ncols = names.length;
  const meta = t.info.meta;
  const cache = new Map();          // block → display rows (insertion-order LRU)
  const inflight = new Map();
  const readyCbs = [];
  const notify = () => { for (const cb of readyCbs) { try { cb(); } catch (e) { console.error('[lamina] onReady threw', e); } } };

  // → the block's display rows (resolved WITH the rows: a burst of result-view reads
  // may evict the block from the LRU before an awaiting caller looks it up)
  function loadBlock(b) {
    if (cache.has(b)) return Promise.resolve(cache.get(b));
    if (inflight.has(b)) return inflight.get(b);
    const i0 = b * K, i1 = Math.min(n, i0 + K);
    const p = readParquetRows(buf, { rowStart: i0, rowEnd: i1, columns: names, metadata: meta }).then((rows) => {
      const disp = rows.map((r) => r.map(dispOf));
      cache.set(b, disp);
      while (cache.size > cacheBlocks) cache.delete(cache.keys().next().value);
      inflight.delete(b); notify();
      return disp;
    }, (err) => { inflight.delete(b); console.error('[lamina] parquet block read failed', err); throw err; });
    inflight.set(b, p);
    return p;
  }
  function cachedRow(r) {
    const b = Math.floor(r / K);
    if (!cache.has(b)) return null;
    const rows = cache.get(b); cache.delete(b); cache.set(b, rows);          // LRU touch
    return rows[r - b * K] || null;
  }

  const view = {
    kind: 'delimited', cols: ncols, schema: t.schema,
    rowCount() { return n; },
    rowAt(r) {
      if (r < 0 || r >= n) return null;
      const row = cachedRow(r);
      if (row) return row;
      loadBlock(Math.floor(r / K)).catch(() => {});
      return LOADING;
    },
    async ensureRow(r) { if (r >= 0 && r < n) await loadBlock(Math.floor(r / K)); return this.rowAt(r); },
    header(c) { return { label: names[c] != null ? names[c] : `col ${c + 1}`, type: this.colType(c) }; },
    colType(c) { return (t.schema[c] && t.schema[c].type) || 'string'; },
    onReady(cb) { readyCbs.push(cb); return () => { const i = readyCbs.indexOf(cb); if (i >= 0) readyCbs.splice(i, 1); }; },
  };

  // the footer min/max of a row group's NUMBER columns, as @gcu/expr canMatch reads them
  const numeric = new Set(t.fields.filter((f) => f.kind === 'number').map((f) => f.name));
  const rangesOf = (rg) => {
    const out = {};
    for (const nm in rg.columns) {
      if (!numeric.has(nm)) continue;
      const st = rg.columns[nm], mn = Number(st.min), mx = Number(st.max);
      if (Number.isFinite(mn) && Number.isFinite(mx)) out[nm] = { min: mn, max: mx, ...(st.nulls === 0 ? { hasBlank: false } : {}) };
    }
    return out;
  };

  const cursor = {
    kind: 'parquet', rowCount: n, schema: t.schema, delimiter: '\t', quote: '"',
    skipped: 0,                     // row groups the last pruned scan skipped (automation / the footer)
    // eachRecord(opts, visit(disp, rawFields, loc0, loc1)) — the @gcu/lamina cursor
    // contract. `cols` = column indices to read (others stay undefined); `prune(ranges)`
    // false = this row group can't match, skip it; `rows` = an ascending subset.
    async eachRecord({ dataStart = 0, rows = null, onProgress, limit = Infinity, cols = null, prune = null, signal } = {}, visit) {
      const want = cols ? cols.filter((i) => i >= 0 && i < ncols) : null;
      const readNames = want ? want.map((i) => names[i]) : names;
      let start = 0, sp = 0, seen = 0;
      cursor.skipped = 0;
      for (const rg of t.rowGroups) {
        const gEnd = start + rg.rowCount;
        if (prune && !prune(rangesOf(rg))) {
          cursor.skipped++;
          start = gEnd; if (onProgress) onProgress(start, n); continue;
        }
        for (let s = start; s < gEnd; s += slice) {
          if (signal && signal.aborted) throw new DOMException('cancelled', 'AbortError');
          const e = Math.min(gEnd, s + slice);
          if (rows) {                                          // nothing of the subset in this slice → don't read it
            while (sp < rows.length && rows[sp] + dataStart < s) sp++;
            if (sp >= rows.length) return;
            if (rows[sp] + dataStart >= e) continue;
          }
          const got = await readParquetRows(buf, { rowStart: s, rowEnd: e, columns: readNames, metadata: meta });
          for (let k = 0; k < got.length; k++) {
            const i = s + k, disp = i - dataStart;
            if (disp < 0) continue;
            if (rows) {
              while (sp < rows.length && rows[sp] < disp) sp++;
              if (sp >= rows.length || rows[sp] !== disp) continue;
              sp++;
            }
            const src = got[k];
            let vals;
            if (want) { vals = new Array(ncols); for (let j = 0; j < want.length; j++) vals[want[j]] = rawOf(src[j]); }
            else { vals = new Array(ncols); for (let j = 0; j < ncols; j++) vals[j] = rawOf(src[j]); }
            visit(disp, vals, i, 0);
            if (++seen >= limit) return;
          }
          if (onProgress) onProgress(e, n);
          if (rows && sp >= rows.length) return;
        }
        start = gEnd;
      }
    },
    async readByLoc(i) {
      const b = Math.floor(i / K);
      const row = (await loadBlock(b))[i - b * K];
      return row ? row.slice() : new Array(ncols).fill('');
    },
  };
  return { view, cursor };
}
