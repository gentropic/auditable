# @gcu/shp

ESRI **Shapefile** reader/writer — `.shp` geometry, `.shx` index, `.dbf` attributes, `.prj`
coordinate system — over GeoJSON-shaped features. Zero-dependency and first-party, so a
Sealed tool (no CDN, no network) can read the format GIS people hand each other.

```js
import { readShapefile, writeShapefile, prjInfo } from '@gcu/shp';

const set = readShapefile({ shp, dbf, prj, cpg });      // ArrayBuffer / Uint8Array each (only shp required)
set.features[0];  // → { geometry: { type: 'Polygon', coordinates: [[[x, y, z], …], …] }, properties: { NAME: 'pit' } }
set.crs;          // → { kind: 'projected', name: 'SIRGAS 2000 / UTM zone 23S', epsg: 31983 }

const out = writeShapefile(set.features, { prj: set.prj });
// → { shp, shx, dbf, cpg: 'UTF-8', prj, fields }
```

## What it handles

- Point / MultiPoint / PolyLine / Polygon, plain, **Z** and **M** (the measure is dropped —
  it is not a coordinate). Null shapes read as `null`. MultiPatch is skipped with a warning.
- Polygon rings are reassembled: outer rings (clockwise) take the holes (counter-clockwise)
  that they contain → `Polygon` or `MultiPolygon`. A file that ignores the winding rule still
  reads. Writing enforces it.
- dBASE III: C / N / F / L / D (+ I / O). Text decodes by the `.cpg` (or UTF-8, then
  windows-1252). Writing emits C and N fields, UTF-8, with a `.cpg`; field names are cut to
  10 bytes and made unique.
- `prjInfo(text)` → `{ kind: 'geographic' | 'projected' | 'local' | 'unknown', name, epsg? }` —
  the one question a viewer that never reprojects has to ask: metres, or degrees?

## Not in scope

Reprojection (by design — the caller refuses or reprojects); `.sbn` / `.qix` spatial indexes;
MultiPatch; memo (`.dbt`) fields. Finding the parts in a `.zip` is the caller's job.

MIT · part of [auditable](https://github.com/gentropic/auditable).
