// @gcu/shp — ESRI Shapefile read/write, first-party and zero-dependency.
//
// The .shp geometry (+ .shx index), the .dbf attribute table and the .prj coordinate-system
// text, as GeoJSON-shaped features. Bytes in, bytes out: finding the parts (loose files, a
// .zip) is the caller's job, and so is deciding what a geographic .prj means — prjInfo
// says which kind of system it is; this package never reprojects.

export { readShapefile, writeShapefile } from './shapefile.js';
export { readShp, writeShp, shapeTypeOf, ringArea, assembleRings } from './shape.js';
export { readDbf, writeDbf, dbfFields } from './dbf.js';
export { prjInfo } from './prj.js';
