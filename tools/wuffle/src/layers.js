// wuffle → @gcu/stereonet: a diagram's layers as the core's plain layer inputs. The ONE place wuffle's model
// meets the shared core; pure, so a figure export or a test builds the same scene the desk draws.

import { orientations } from './io.js';

/** @returns {object[]} layers for stereonetCore(…).buildScene, in draw order */
export function sceneLayers(project, diagramId) {
  return project.layersOf(diagramId).map((L) => {
    const ds = project.dataset(L.datasetId);
    // a label per row when the layer draws labels: the chosen column's value, else the row number (1-based)
    const lab = L.elements.labels?.on ? (L.elements.labels.column && ds.columns.includes(L.elements.labels.column) ? (row) => String(ds.rows[row][L.elements.labels.column] ?? '') : (row) => String(row + 1)) : null;
    const data = orientations(ds).map((o, row) => (o ? { row, ...o, ...(lab ? { label: lab(row) } : {}) } : null)).filter(Boolean);
    return { id: L.id, datasetId: ds.id, kind: ds.kind, visible: L.visible, color: L.style.color, size: L.style.size,
      elements: L.elements, data, selected: project.selected(ds.id) };
  });
}
