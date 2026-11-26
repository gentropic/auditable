// wuffle → @gcu/stereonet: a diagram's layers as the core's plain layer inputs. The ONE place wuffle's model
// meets the shared core; pure, so a figure export or a test builds the same scene the desk draws.

import { orientations } from './io.js';

/** @returns {object[]} layers for stereonetCore(…).buildScene, in draw order */
export function sceneLayers(project, diagramId) {
  return project.layersOf(diagramId).map((L) => {
    const ds = project.dataset(L.datasetId);
    const data = orientations(ds).map((o, row) => (o ? { row, ...o } : null)).filter(Boolean);
    return { id: L.id, datasetId: ds.id, kind: ds.kind, visible: L.visible, color: L.style.color, size: L.style.size,
      elements: L.elements, data, selected: project.selected(ds.id) };
  });
}
