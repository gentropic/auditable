# @gcu/proj

Coordinate reference systems for Sealed (offline, `connect-src 'none'`) tools: **proj4js 2.22.0**
vendored verbatim, the **full EPSG table** (6,983 projected + geographic-2D systems with a proj4
definition, names, areas of use) and a **Natural Earth 1:110m** world outline, all carried in the
bundle and inflated on first use with `DecompressionStream`. Nothing at import, no network ever.

Where `@gcu/frame` names a CRS and never reprojects, this package reprojects — and every transform
says how, and how well.

```js
import { lookupEpsg, crsFromPrj, transformPoints, describePath } from '@gcu/proj';

const sad = await lookupEpsg(29193), sirgas = await lookupEpsg(31983);
transformPoints(sad, sirgas, [[612000, 7765000, 850]]);   // → [[x', y', 850]] (z carried)
describePath(sad, sirgas, { at: [-44, -20] }).text;
// 'SAD69 → SIRGAS 2000 by 3-parameter Helmert (-67.35, +3.88, -38.22 m, IBGE R.PR 1/2005 (= EPSG 15485)) — ~1–5 m'
```

## API

- **Table:** `loadEpsgTable()`, `lookupEpsg(code)`, `searchCrs(query, { kind, fits, codes, limit })`,
  `suggestCrs(lonLatExtent)`, `bboxHolds(bbox, extent)`.
- **CRS objects** — `{ code, epsg, name, kind: 'projected'|'geographic', def, units, datum, bbox
  [w, s, e, n], area, accuracy }`: `crsFromPrj(wkt)` (authority, else ESRI name matched to EPSG,
  else custom), `crsFromDefinition(text)` (code / proj4 / WKT), `crsFromGeoKeys`, `crsFromUrn`,
  `customCrs(def)`, `crsLabel`, `crsToJSON` / `crsFromJSON`, `sameCrs`.
- **Transforms** (horizontal; z carried): `transformPoints(from, to, pts)`, `transformFlat`,
  `transformer(from, to, { at })`, `toLonLat`, `fromLonLat`, `extentLonLat`.
- **The path and its accuracy:** `describePath(from, to, { at })` → `{ text, accuracy: { class:
  'exact'|'sub-metre'|'metre'|'grid'|'unknown', metres, text }, datumShift }`.
- **Datum shifts:** `DATUM_SHIFTS` / `registerDatumShift` — published shifts that replace a table
  default (IBGE's SAD69 parameters inside Brazil; Córrego Alegre, whose EPSG default needs a grid).
  `loadGrid(name, buffer)` — an NTv2 grid a definition names (none bundled; a missing grid is
  reported as `unknown`, never shifted silently).
- **.prj out:** `crsToPrj(crs)` → `{ text, why }` — ESRI-flavoured WKT1 (ESRI names; a top-level
  `AUTHORITY["EPSG", n]` for a table system) generated from the proj4 definition: geographic, TM /
  UTM, LCC (1SP / 2SP), Albers, polar stereographic, Mercator, Polyconic, LAEA, Cassini, Equidistant
  Cylindrical — 6,730 of the table's 6,983, each verified to read back (`test/proj-wkt.test.mjs`).
  Anything else, a non-east/north axis, or a custom system with a grid shift: `text` null and
  `why` says so.
- **World:** `worldRings()` → lon/lat rings.

## Regenerating

The vendored proj4 and the data are generated from pinned tarballs (fetched by hand; hashes in
`vendor/VENDOR.json`):

```
npm pack proj4@2.22.0 epsg-index@2.0.0 world-atlas@2.0.2   # then extract each
node ext/proj/tools/vendor-proj4.mjs <proj4>/package
node ext/proj/tools/gen-epsg.mjs <epsg-index>/package
node ext/proj/tools/gen-world.mjs <world-atlas>/package
node ext/proj/build.js
```

Licences: proj4js, wkt-parser, mgrs (MIT), epsg-index (ISC; the EPSG Geodetic Parameter Dataset),
world-atlas (ISC; Natural Earth data is public domain) — in `vendor/`. Tests: `test/proj.test.mjs`, `test/proj-wkt.test.mjs`.
