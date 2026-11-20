// via='files' Parquet block models — micro's openParquetBlocks ported onto the
// widget's RemoteBlob. The blob is sliced by range for every read (footer, then
// row group by row group), so a multi-GB file costs no residency anywhere: not
// in the kernel, not in the page. A micro-written file is SELF-DESCRIBING (the
// `micro:model` kv carries grid + bbox + categories), so opening micro's own
// optimized store skips discovery entirely — the loop closes.
import { mapColumns, inferAxis } from '../../index.js';

// @gcu/parquet rides EMBEDDED AS SOURCE and is imported once via a blob URL on
// first use: it is a vendored minified rollup bundle whose ALIASED exports
// (`export{e as parquetInfoAsync}`) @gcu/build's source merge cannot rewire.
// Still self-contained — nothing is fetched at runtime. The marker below is
// substituted by build.js with the bundle's JSON-stringified source.
const PQ_SRC = __PARQUET_SRC__;
let _pq = null;
async function pqMod() {
  if (!_pq) {
    const url = URL.createObjectURL(new Blob([PQ_SRC], { type: 'text/javascript' }));
    // a controlled dynamic-import site (the bundler forbids the literal form;
    // a strict no-eval CSP lands in buildFileLayer's catch with an honest hud)
    const dynImport = new Function('u', 'return import(u)');
    try { _pq = await dynImport(url); } finally { URL.revokeObjectURL(url); }
  }
  return _pq;
}

const _pqNum = (t) => /INT|FLOAT|DOUBLE|DECIMAL/.test(t || '');

export async function openParquetBlocks(blob, { map = null } = {}) {
  const { parquetInfoAsync, streamParquetColumns } = await pqMod();
  // hyparquet wants an AsyncBuffer; RemoteBlob speaks Blob (size/slice) — one
  // wrapper and every read below range-reads through it
  const buf = { byteLength: blob.size, slice: (s, e) => blob.slice(s, e == null ? blob.size : e).arrayBuffer() };
  const info = await parquetInfoAsync(buf);
  const names = info.columns.map((c) => c.name);
  const typeOf = {};
  info.columns.forEach((c) => { typeOf[c.name] = c.type; });
  if (names.length < 3) throw new Error('parquet: need at least 3 columns (X, Y, Z)');
  // column roles: the caller's NAMES (via='files' map) override the auto-sniff
  const mapping = mapColumns(names) || { x: 0, y: 1, z: 2, chan: names.length > 3 ? 3 : null, cat: null };
  if (map) {
    const idx = (nm) => (nm == null ? -1 : names.indexOf(nm));
    for (const [k, mk] of [['x', 'x'], ['y', 'y'], ['z', 'z'], ['chan', 'value'], ['cat', 'category']]) {
      const i = idx(map[mk]);
      if (i >= 0) mapping[k] = i;
    }
  }
  if (mapping.x == null || mapping.y == null || mapping.z == null) throw new Error('parquet: could not identify X/Y/Z centroid columns');
  if (mapping.chan != null && !_pqNum(typeOf[names[mapping.chan]])) mapping.chan = null;
  if (mapping.cat == null) {
    for (let i = 0; i < names.length; i++) {
      if (i === mapping.x || i === mapping.y || i === mapping.z || i === mapping.chan) continue;
      if (!_pqNum(typeOf[names[i]])) { mapping.cat = i; break; }
    }
  }
  const xN = names[mapping.x], yN = names[mapping.y], zN = names[mapping.z];
  const chanN = mapping.chan != null ? names[mapping.chan] : null;
  const catN = mapping.cat != null ? names[mapping.cat] : null;
  const N = info.rowCount;
  if (!N) throw new Error('parquet: empty table');

  // micro-written files describe themselves — kv `micro:model` = grid + bbox +
  // categories, so no discovery sweep at all
  let kvModel = null;
  try {
    const e = (info.meta.key_value_metadata || []).find((x) => x.key === 'micro:model');
    if (e) kvModel = JSON.parse(e.value);
  } catch { /* a foreign file */ }
  let grid = null, categories = null, min, max;
  if (kvModel && kvModel.bbox) {
    grid = kvModel.grid || null;
    categories = kvModel.categories || null;
    min = [...kvModel.bbox.min]; max = [...kvModel.bbox.max];
  } else {
    // discovery: ONE streamed pass over coords (+ cat) — a row group resident
    // at a time, nothing retained
    const CAP = 100000, r10 = (v) => Number(v.toPrecision(10));
    min = [Infinity, Infinity, Infinity]; max = [-Infinity, -Infinity, -Infinity];
    const ax = [new Set(), new Set(), new Set()];
    const catSet = catN ? new Set() : null;
    const discCols = catN ? [xN, yN, zN, catN] : [xN, yN, zN];
    for await (const { count, cols } of streamParquetColumns(buf, discCols, info.rowGroups, info.meta)) {
      const X = cols[xN], Y = cols[yN], Z = cols[zN], C = catN ? cols[catN] : null;
      for (let i = 0; i < count; i++) {
        const xv = +X[i], yv = +Y[i], zv = +Z[i];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
        if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
        if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
        if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
        if (ax[0].size < CAP) ax[0].add(r10(xv));
        if (ax[1].size < CAP) ax[1].add(r10(yv));
        if (ax[2].size < CAP) ax[2].add(r10(zv));
        if (catSet && catSet.size <= 256) { const v = C[i]; if (v != null && v !== '') catSet.add(String(v)); }
      }
    }
    const axes = ax.map((set) => (set.size < CAP ? inferAxis([...set].sort((a, b) => a - b)) : null));
    grid = axes.every(Boolean) ? { x: axes[0], y: axes[1], z: axes[2] } : null;
    categories = catSet && catSet.size > 0 && catSet.size <= 255 ? [...catSet].sort() : null;
  }
  const catCode = categories ? new Map(categories.map((v, i) => [v, i])) : null;
  const header = { kind: 'blockmodel', count: N, bbox: { min, max }, grid, columns: names, mapping, categories, parquet: true };

  async function* streamChunks() {
    const cnames = [xN, yN, zN, ...(chanN ? [chanN] : []), ...(catN ? [catN] : [])];
    for await (const { start, count, cols } of streamParquetColumns(buf, cnames, info.rowGroups, info.meta)) {
      const X = cols[xN], Y = cols[yN], Z = cols[zN], CH = chanN ? cols[chanN] : null, CA = catN ? cols[catN] : null;
      const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count), chan = new Float64Array(count);
      const cat = catCode ? new Uint8Array(count) : null, recIdx = new Uint32Array(count);
      for (let i = 0; i < count; i++) {
        x[i] = +X[i]; y[i] = +Y[i]; z[i] = +Z[i];
        chan[i] = CH ? +CH[i] : 0;
        if (cat) cat[i] = catCode.get(String(CA[i] ?? '')) ?? 0;
        recIdx[i] = start + i;
      }
      yield { count, x, y, z, chan, cat, recIdx, recStart: start };
    }
  }
  return { header, streamChunks };
}
