// @gcu/proj table — the EPSG table (every projected + geographic-2D CRS with a proj4 definition),
// carried gzip + base64 in data-epsg.js and inflated ON FIRST USE with DecompressionStream:
// nothing runs at import, nothing touches the network.
//
//   await loadEpsgTable()        → the table (cached; concurrent callers share one inflate)
//   epsgTable()                  → the table if already loaded, else null (sync)
//   await lookupEpsg(code)       → a CRS object, or null
//   await searchCrs(q, opts)     → CRS objects ranked for a query (name words / a code)
//   await suggestCrs(extent)     → projected CRS whose area of use holds a lon/lat extent, best first
//
// A CRS object (frozen, one per code): { code: 'EPSG:31983', epsg: 31983, name, kind:
// 'projected' | 'geographic', def (proj4), units, datum (the base geographic system's name),
// bbox [west, south, east, north] (area of use, degrees) | null, area (its description),
// accuracy (metres — the stated accuracy of the default datum shift to WGS 84) | null }.
import { EPSG_GZ_B64, EPSG_SOURCE } from './data-epsg.js';

export { EPSG_SOURCE };

export async function gunzipBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let _table = null, _loading = null;
export function epsgTable() { return _table; }
export function loadEpsgTable() {
  if (_table) return Promise.resolve(_table);
  if (!_loading) _loading = (async () => {
    const cols = JSON.parse(new TextDecoder().decode(await gunzipBase64(EPSG_GZ_B64)));
    const names = cols.name.split('\n'), defs = cols.def.split('\n');
    const n = cols.code.length;
    const byCode = new Map();
    for (let i = 0; i < n; i++) byCode.set(cols.code[i], i);
    const cache = new Array(n);
    const norm = names.map(normName);
    const entry = (i) => {
      if (cache[i]) return cache[i];
      const kind = cols.kind[i] === 'p' ? 'projected' : 'geographic';
      const b = cols.bbox.slice(4 * i, 4 * i + 4);
      const name = names[i], def = defs[i];
      const unit = cols.units[cols.unit[i]] || '';
      cache[i] = Object.freeze({
        code: `EPSG:${cols.code[i]}`, epsg: cols.code[i], name, kind, def,
        units: unit || unitsOfDef(def, kind),
        datum: kind === 'geographic' ? name : name.split(' / ')[0],
        bbox: b.every((v) => v != null) ? Object.freeze(b) : null,
        area: cols.areas[cols.area[i]] || '',
        accuracy: cols.acc[i],
      });
      return cache[i];
    };
    _table = { count: n, codes: cols.code, names, norm, entry, byCode, source: EPSG_SOURCE, kinds: cols.kind };
    return _table;
  })();
  return _loading;
}

// the unit a proj4 definition implies, when the table doesn't say
export function unitsOfDef(def, kind) {
  if (kind === 'geographic' || /\+proj=(longlat|latlong|lonlat|latlon)\b/.test(def)) return 'degree';
  const u = /\+units=(\S+)/.exec(def);
  if (u) return { m: 'metre', km: 'kilometre', 'us-ft': 'US survey foot', ft: 'foot', yd: 'yard', 'ind-ft': 'Indian foot', ch: 'chain', link: 'link' }[u[1]] || u[1];
  const t = /\+to_meter=(\S+)/.exec(def);
  if (t) return `${t[1]} m`;
  return 'metre';
}

// a name for matching: accents off, lower case, letters and digits only, 19xx years → xx (ESRI
// writes SAD_1969 and WGS_1984 where EPSG writes SAD69 and WGS 84), an ESRI "GCS_" prefix off
export function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/^gcs[_\s]+/, '').replace(/(^|[^0-9])19(\d\d)(?=[^0-9]|$)/g, '$1$2')
    .replace(/[^a-z0-9]+/g, '');
}

export async function lookupEpsg(code) {
  const t = await loadEpsgTable();
  const c = typeof code === 'string' ? +String(code).replace(/^\s*EPSG\s*:+\s*/i, '') : +code;
  const i = t.byCode.get(c);
  return i == null ? null : t.entry(i);
}
export function lookupEpsgSync(code) {
  const t = _table; if (!t) return null;
  const c = typeof code === 'string' ? +String(code).replace(/^\s*EPSG\s*:+\s*/i, '') : +code;
  const i = t.byCode.get(c);
  return i == null ? null : t.entry(i);
}

// does a CRS's area of use hold an extent [w, s, e, n] (degrees)? Areas that cross the
// antimeridian are stored with west > east.
export function bboxHolds(b, ext) {
  if (!b || !ext) return false;
  const [w, s, e, n] = b;
  if (ext[1] < s - 1e-9 || ext[3] > n + 1e-9) return false;
  if (w <= e) return ext[0] >= w - 1e-9 && ext[2] <= e + 1e-9;
  return (ext[0] >= w - 1e-9 || ext[2] <= e + 1e-9);   // across ±180
}
const bboxArea = (b) => { if (!b) return Infinity; const dx = b[0] <= b[2] ? b[2] - b[0] : 360 - (b[0] - b[2]); return dx * Math.max(1e-6, b[3] - b[1]); };

// search: a number → that code first, then codes starting with it; words → every word must be
// in the name (any order). Filters: kind ('projected' | 'geographic'), fits (a lon/lat extent
// the area of use must hold), codes (only these — "recently used"). Ranked: exact code, name
// starts with the query, then shorter names; `limit` caps the list.
export async function searchCrs(query = '', { kind = null, fits = null, codes = null, limit = 200 } = {}) {
  const t = await loadEpsgTable();
  const q = String(query || '').trim();
  const qn = q.replace(/^epsg\s*:*\s*/i, '');
  const isNum = /^\d+$/.test(qn);
  const words = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[\s/·,]+/).filter(Boolean).map(normName).filter(Boolean);
  const pool = codes ? codes.map((c) => t.byCode.get(+String(c).replace(/^EPSG:/i, ''))).filter((i) => i != null) : null;
  const hits = [];
  const N = pool ? pool.length : t.count;
  for (let k = 0; k < N; k++) {
    const i = pool ? pool[k] : k;
    if (kind && (t.kinds[i] === 'p' ? 'projected' : 'geographic') !== kind) continue;
    let score;
    if (!q) score = pool ? -k : 0;
    else if (isNum) {
      const cs = String(t.codes[i]);
      if (cs === qn) score = 1e6; else if (cs.startsWith(qn)) score = 1e5 - cs.length; else continue;
    } else {
      const nm = t.norm[i];
      if (!words.every((w) => nm.includes(w))) continue;
      score = (nm.startsWith(words[0]) ? 1000 : 0) - t.names[i].length;
    }
    if (fits && !bboxHolds(t.entry(i).bbox, fits)) continue;
    hits.push([score, i]);
  }
  hits.sort((a, b) => b[0] - a[0] || t.codes[a[1]] - t.codes[b[1]]);
  return hits.slice(0, limit).map(([, i]) => t.entry(i));
}

// systems a user is likely to want, ranked — modern datums, UTM, metres, the tightest area of use
const MODERN = /^(SIRGAS 2000|WGS 84|ETRS89|NAD83\(2011\)|NAD83\(CSRS\)|GDA2020|GDA94|NZGD2000|JGD2011|CGCS2000|RGF93|ITRF|SIRGAS-|MAGNA-SIRGAS|SIRGAS_|POSGAR 2007|RGSPM06|Hartebeesthoek94|KGD2002|TWD97|IGM95|SWEREF99|EUREF|LKS94|ETRF2000|PRS92|GRS 1980)/;
export async function suggestCrs(ext, { limit = 8, kind = 'projected' } = {}) {
  const t = await loadEpsgTable();
  if (!ext) return [];
  const e = ext.length === 2 ? [ext[0], ext[1], ext[0], ext[1]] : ext;
  const out = [];
  for (let i = 0; i < t.count; i++) {
    if (kind && (t.kinds[i] === 'p' ? 'projected' : 'geographic') !== kind) continue;
    const c = t.entry(i);
    if (!bboxHolds(c.bbox, e)) continue;
    if (/deprecated/i.test(c.name)) continue;
    let s = -Math.log(bboxArea(c.bbox));
    if (MODERN.test(c.datum)) s += 6;
    if (/UTM zone/.test(c.name)) s += 4;
    if (c.units === 'metre') s += 2; else s -= 4;
    if (c.accuracy != null && c.accuracy > 2) s -= 2;
    if (/\+nadgrids=(?!@null)/.test(c.def)) s -= 1;
    if (/Pseudo-Mercator|Popular Visualisation|Lat-Long/i.test(c.name)) s -= 8;
    if (/\((N-E|E-N|N-zE|E-zN|zE-N|zN-E|[A-Z]-[A-Z]|.*axis.*)\)\s*$/i.test(c.name)) s -= 3;   // the same system with another axis order
    out.push([s, c]);
  }
  out.sort((a, b) => b[0] - a[0] || a[1].epsg - b[1].epsg);
  return out.slice(0, limit).map(([, c]) => c);
}
