// @gcu/shp prj — what a .prj (an ESRI / OGC WKT coordinate system) says, in one word.
//
//   prjInfo(text) → { kind: 'geographic' | 'projected' | 'local' | 'unknown', name, epsg? }
//
// Only the top-level keyword matters for the question a viewer that never reprojects has
// to ask — "are these metres, or are these degrees?": GEOGCS / GEOGCRS / GEODCRS → degrees
// (longitude/latitude); PROJCS / PROJCRS → a projected system; LOCAL_CS / ENGCRS → a local
// engineering grid. `name` is the system's own name (its first quoted string); `epsg` is
// read from a top-level AUTHORITY["EPSG", …] / ID["EPSG", …] when the file carries one.

export function prjInfo(text) {
  const s = String(text || '').replace(/^﻿/, '').trim();
  if (!s) return { kind: 'unknown', name: null };
  const m = /^([A-Z_]+)\s*\[\s*"([^"]*)"/i.exec(s);
  if (!m) return { kind: 'unknown', name: null };
  const kw = m[1].toUpperCase(), name = m[2];
  let kind = 'unknown';
  if (kw === 'GEOGCS' || kw === 'GEOGCRS' || kw === 'GEOGRAPHICCRS') kind = 'geographic';
  else if (kw === 'GEODCRS' || kw === 'GEODETICCRS') kind = /ELLIPSOIDAL/i.test(s) ? 'geographic' : 'unknown';
  else if (kw === 'PROJCS' || kw === 'PROJCRS' || kw === 'PROJECTEDCRS') kind = 'projected';
  else if (kw === 'LOCAL_CS' || kw === 'ENGCRS' || kw === 'ENGINEERINGCRS') kind = 'local';
  // the LAST authority in the text is the top-level one (nested ones come first)
  const ids = [...s.matchAll(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)];
  const out = { kind, name };
  if (ids.length) out.epsg = +ids[ids.length - 1][1];
  return out;
}
