// wuffle desk — files in and out: measurements (any delimited text; io.js reads it, never refusing) become
// datasets drawn on the active net; a .wuffle project replaces the current one in place (the views keep
// their listeners); Save writes the project as JSON. Opening is by picker, by drop on the window, or the
// built-in sample.

import { alert } from '../../../ext/dialog/index.js';
import { Project } from './model.js';
import { readTable } from './io.js';

export function createFiles(root, { project: p, dropHost, onOpened }) {
  /** text → dataset(s), each drawn on the active net (made if there is none) → the first dataset's id */
  const addData = (text, name) => {
    const specs = readTable(text, String(name).replace(/\.[^.]+$/, ''));
    let first = null;
    for (const s of specs) {
      const id = p.addDataset(s); first = first || id;
      if (!p.activeDiagram) p.addDiagram('net');
      p.addLayer(p.activeDiagram, id);
    }
    if (first && onOpened) onOpened(first);
    return first;
  };
  /** a project file replaces the current project IN PLACE, so every listener stays attached */
  const loadProject = (j) => {
    const q = Project.fromJSON(j);
    Object.assign(p, { name: q.name, datasets: q.datasets, diagrams: q.diagrams, layers: q.layers, figures: q.figures, selection: q.selection, activeDiagram: q.activeDiagram, _seq: q._seq });
    p._emit('project-loaded');
  };
  const open = async (files) => {
    for (const f of files) {
      const text = await f.text();
      if (/\.(wuffle|json)$/i.test(f.name)) { try { loadProject(JSON.parse(text)); } catch (e) { await alert(`${f.name}: ${e.message}`); } continue; }
      addData(text, f.name);
    }
  };
  const save = () => {
    const blob = new Blob([JSON.stringify(p.toJSON(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(p.name || 'untitled').replace(/[^\w.-]+/g, '_')}.wuffle`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const picker = document.createElement('input');
  picker.type = 'file'; picker.multiple = true; picker.accept = '.csv,.txt,.tsv,.dat,.wuffle,.json'; picker.hidden = true;
  picker.onchange = () => { open([...picker.files]); picker.value = ''; };
  root.append(picker);

  let veil = null;
  const hide = () => { veil?.remove(); veil = null; };
  root.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    if (!veil) { veil = document.createElement('div'); veil.className = 'wdrop'; veil.textContent = 'drop measurements or a .wuffle project'; dropHost.append(veil); }
  });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) hide(); });
  root.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); hide(); open([...e.dataTransfer.files]); });

  return { addData, loadProject, open, save, pick: () => picker.click() };
}
