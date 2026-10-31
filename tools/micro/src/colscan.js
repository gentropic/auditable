// micro colscan — the adapter from a micro LAYER to @gcu/scan (src/scanner.js).
//
// A tool hands over the expressions it needs and a kernel; this works out the
// layer's dependency cone once — which source columns to read (and only those),
// which calc columns to evaluate in what order, which page-resident columns
// (painted codes, materialized values) are involved — maps the layer to a scan
// SOURCE (a Parquet model's row groups, a .dm's page runs, an indexed delimited
// model's runs), and runs it. The engine, the pool, the kernels and the workers
// are the package's; what's micro's is the layer: its schema, its paint and calc
// columns, its pin cache.
import { scan } from './scanner.js';
import { layerTableHeader, schemaExt, calcOrder, colIsNumeric, qualifyPolicy } from './records.js';
import { chunkSpecOf, chunkPageOf, expandedDeps, ensureStoredValues } from './columns.js';
import { delimitedRuns } from '../../../ext/condenser/src/main.js';
import * as E from '../../../ext/expr/index.js';
const { parse } = E;

export function canScanColumnar(L) {
  const bd = L && L.docs && L.docs.blockDoc;
  if (!bd) return false;
  if (bd.parquet || (bd.header && bd.header.dm)) return true;
  return csvColumnar && !!bd.blob && !!bd.header.mapping && delimitedRuns(bd.header, bd.blob.size, 1).length > 0;
}
// smoke hooks: the delimited source off (the row path's answer, for comparison)
// and its run length in index entries (small, so a small test file has several)
// 64 entries = 65536 records: one sidecar BAND, so the filter's band pushdown
// skips whole runs exactly as it skipped bands
let csvColumnar = true, csvAnchors = 64, zonesOn = true;
export function setCsvColumnar(on, anchors = 64, zones = true) { csvColumnar = !!on; csvAnchors = anchors; zonesOn = !!zones; }

// ZONE MAPS → keep(z) (@gcu/scan zoneKeep). What's the layer's: which columns'
// statistics still apply — a column the schema now types differently from when
// the zones were made is read, never skipped by.
export function zoneKeeper(L, { ast = null, bbox = null, mask = null } = {}) {
  const bd = L && L.docs && L.docs.blockDoc, zs = bd && !bd.parquet && !bd.header.dm && bd.header.zones;
  if (!zs || !zonesOn || !csvColumnar || !(ast || bbox || mask)) return null;
  const h = layerTableHeader(L), m = h.mapping;
  const type = new Map(schemaExt(L, h).map((c) => [String(c.name).toLowerCase(), c.type]));
  const names = [];
  if (ast) {
    for (const d of expandedDeps(L, ast)) {
      const t = type.get(d);
      const nm = Object.keys(zs.num).find((x) => x.toLowerCase() === d) || Object.keys(zs.cat).find((x) => x.toLowerCase() === d);
      if (nm && ((zs.num[nm] && t === 'number') || (zs.cat[nm] && t === 'string'))) names.push(nm);
    }
  }
  return scan.zoneKeep(zs, { ast, names, bbox, mask, coords: [h.columns[m.x], h.columns[m.y], h.columns[m.z]] });
}

// the layer as a scan source
function sourceOf(L, readCols, keepZone = null) {
  const bd = L.docs.blockDoc, h = layerTableHeader(L);
  if (bd.parquet) return scan.sources.parquet(bd.parquet, readCols);
  if (!bd.header.dm) {
    // each column as the row path sees it: the row qualifier's substitutes
    // (never on the coordinates), numbers as the pin cache holds them
    const m = h.mapping, schema = schemaExt(L, h), coord = new Set([m.x, m.y, m.z]);
    const cols = readCols.map((n) => {
      const i = h.columns.indexOf(n);
      return { i, num: (schema[i] || {}).type === 'number', policy: !coord.has(i) && colIsNumeric(L, h, i) ? qualifyPolicy(L, n) : null };
    });
    return scan.sources.delimited(bd.blob, h, { delim: h.delim, x: m.x, y: m.y, z: m.z, cols }, readCols, { anchors: csvAnchors, keep: keepZone });
  }
  return scan.sources.dm(bd.blob, bd.header.dm, h.columns, readCols);
}

// exprs: the expression TEXTS the job evaluates (their columns are what's read);
// extraCols: base column names read regardless (coordinates, sub-block dims);
// mask, onProgress, signal, skipGroup, onPart: as @gcu/scan run (src/run.js);
// keepZone(z): a delimited model's zones to read (zoneKeeper) — the rest never are.
export async function scanColumnar(L, { kernel, params, exprs, extraCols = [], mask = null, onProgress = null, signal = null, skipGroup = null, onPart = null, keepZone = null }) {
  const h = layerTableHeader(L);
  const needL = new Set(extraCols.map((c) => String(c).toLowerCase()));
  for (const x of exprs) { if (!x) continue; let ast; try { ast = parse(x); } catch { continue; } for (const d of expandedDeps(L, ast)) needL.add(d); }
  await ensureStoredValues(L, needL);                       // materialized inputs resident (evicted → blanks otherwise)
  const readCols = (L.docs.blockDoc.parquet ? L.docs.blockDoc.parquet.names : h.columns).filter((n) => needL.has(String(n).toLowerCase()));
  const schema = schemaExt(L, h);
  const baseLen = h.columns.length, paintLen = (L.paintCols || []).length;
  const calcs = calcOrder(L).filter((it) => needL.has(String(it.c.name).toLowerCase())).map((it) => ({ slot: baseLen + paintLen + it.idx, expr: it.c.expr }));
  const spec = chunkSpecOf(L, h, needL);
  return scan.run({
    source: sourceOf(L, readCols, keepZone), kernel, params: { ...params, schema }, calcs, spec, readCols,
    page: (start, count, opts) => chunkPageOf(L, spec, start, count, opts),
    mask, onProgress, signal, skipGroup, onPart,
  });
}
