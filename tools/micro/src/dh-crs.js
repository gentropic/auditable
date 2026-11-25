// micro — a drillhole set's COLLAR coordinate system.
//
// A collar file states no CRS (it is a CSV); by default its numbers are read as the project's.
// When the set says otherwise (config.srcCrs — set by the CRS detective's "reproject", saved with
// the set), every collar is REPROJECTED into the project's system as it is read: heights carried,
// the survey (azimuths, dips, depths) relative to the collar, so the whole hole follows. That is
// drillholes' reprojection on read — survey data are reprojected, never placed.
//
//   await collarTransformFor(cfg)  → [[x, y, z], …] → [[x, y, z], …], or null (read as is)
//   await dhRunOpts(cfg)           → cfg + collarTransform, for condenser's drillhole readers
//   await dhReprojection(cfg)      → the reprojection record (path + accuracy) for lineage / info
import { S } from './state.js';
import { crsFromJSON, sameCrs, transformPoints, reprojectionRecord, WGS84 } from './crs.js';

async function srcOf(cfg) {
  if (!cfg || !cfg.srcCrs || !S.crs) return null;
  let from = null;
  try { from = await crsFromJSON(cfg.srcCrs); } catch { from = null; }
  if (!from) throw new Error(`the collars' coordinate system (${cfg.srcCrs.name || cfg.srcCrs.epsg || '?'}) is not one micro knows`);
  return sameCrs(from, S.crs) ? null : from;
}
export async function collarTransformFor(cfg) {
  const from = await srcOf(cfg);
  if (!from) return null;
  const to = S.crs;
  return (pts) => transformPoints(from, to, pts);
}
export async function dhRunOpts(cfg) {
  const xf = await collarTransformFor(cfg);
  return xf ? { ...cfg, collarTransform: xf } : { ...(cfg || {}) };
}
// centre: a point of the data in the collars' own numbers (where an area-bound shift is chosen)
export async function dhReprojection(cfg, centre = null) {
  const from = await srcOf(cfg).catch(() => null);
  if (!from) return null;
  let at = null;
  try { if (centre) at = transformPoints(from, WGS84, [centre])[0]; } catch { at = null; }
  try { return reprojectionRecord(from, S.crs, at); } catch { return null; }
}
