// @gcu/proj — coordinate reference systems for Sealed tools: proj4js (vendored, pinned) plus the
// FULL EPSG table (every projected + geographic-2D system with a proj4 definition, with names and
// areas of use) and a Natural Earth world outline — carried in the bundle, inflated on first use,
// no network ever. Where @gcu/frame NAMES a CRS and never reprojects, this package reprojects —
// and every transform says how, and how well (describePath).
export { proj4 } from './vendor-proj4.js';
export { EPSG_SOURCE, loadEpsgTable, epsgTable, lookupEpsg, lookupEpsgSync, searchCrs, suggestCrs, bboxHolds, normName, unitsOfDef, gunzipBase64 } from './table.js';
export { WGS84_DEF, looksWkt, customCrs, crsFromCode, crsFromPrj, crsFromDefinition, crsFromUrn, crsFromGeoKeys, crsLabel, crsToJSON, crsFromJSON, sameCrs } from './crs.js';
export { BRAZIL, DATUM_SHIFTS, registerDatumShift, loadGrid, effectiveDef, describePath, transformer, transformPoints, transformFlat, whereOf, toLonLat, fromLonLat, extentLonLat, WGS84 } from './transform.js';
export { worldRings, WORLD_SOURCE } from './world.js';
