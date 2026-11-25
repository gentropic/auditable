// micro CRS, the app side — the "Coordinate system…" command (File menu, ⌘K, the status-bar chip),
// adopting a file's CRS as the project's on open (when none is set), and the offer to set one when
// a geographic file arrives with no project CRS. The state lives in src/crs.js; the dialog in
// src/crs-picker.js.
import { S } from './state.js';
import { projectCrs, setProjectCrs, dataExtentLonLat, onCrsChipClick, updateCrsChip, crsLabel } from './crs.js';
import { openCrsPicker } from './crs-picker.js';
import { microChoose } from './prompts.js';
import { registerCommands, contributeMenu } from './commands.js';
const $ = (s) => document.querySelector(s);

// pick the project's CRS in the selector (fits = where the data sits, when known)
export async function chooseProjectCrs({ fits = null } = {}) {
  const ext = fits || dataExtentLonLat();
  const c = await openCrsPicker({ title: 'project coordinate system', purpose: 'project', fits: ext, initial: projectCrs() });
  if (!c) return null;
  await setProjectCrs(c, { why: 'picked' });
  $('#meta').textContent = `project coordinate system: ${crsLabel(c)} — vectors and point clouds in another system are reprojected into it as they open (models, grids and meshes are not)`;
  return c;
}

// a file stated a projected CRS and the project has none: it becomes the project's
export async function adoptFileCrs(crs, name) {
  if (!crs || projectCrs() || crs.kind === 'geographic') return false;
  await setProjectCrs(crs, { why: `from ${name}` });
  return true;
}

// a geographic file with no project CRS: offer to set one (suggested from the file's extent)
export async function offerProjectCrs(err, name) {
  const ext = err && err.extent;
  const v = await microChoose('this file is in longitude / latitude', `${name} is in degrees (${err && err.fileCrs ? crsLabel(err.fileCrs) : 'WGS 84'}), and the project has no coordinate system to reproject it into. Pick one — the selector suggests one from where the data sits — and the file opens reprojected.`,
    [{ label: 'Cancel', value: false }, { label: 'Set coordinate system…', value: true }]);
  if (!v) return null;
  return chooseProjectCrs({ fits: ext });
}

onCrsChipClick(() => chooseProjectCrs());
try { updateCrsChip(); } catch { /* headless */ }
addEventListener('micro:crs', () => updateCrsChip());

registerCommands([
  { id: 'crs-project', group: 'File', title: 'Coordinate system… (the project’s CRS)', kw: 'crs epsg coordinate reference system projection utm sirgas sad69 datum wgs84 reproject srs prj', run: () => chooseProjectCrs() },
]);
contributeMenu('file', () => [{ label: `Coordinate system… (${S.crs ? (S.crs.epsg ? `EPSG:${S.crs.epsg}` : S.crs.name) : 'none'})`, action: () => chooseProjectCrs() }]);

try { window._microCrsUi = { chooseProjectCrs, adoptFileCrs, offerProjectCrs, openCrsPicker: (o) => openCrsPicker(o) }; } catch { /* headless */ }
