// wuffle desk — figures: compo's editor in a tab, over a page made from a net (figure.js). The host buttons:
// "↻ from the net" (the frames again from the diagram as it is now, layout kept), Export PDF (vectors — the
// net is a 'stereonet' frame, not a picture) and Export PNG. Figures are kept in the project.

import * as bearing from '../../../ext/bearing/index.js';
import { mountEditor, registerKind, exportPDF, exportPNG } from '../../../ext/compo/index.js';
import { stereonetCore } from '../../../ext/stereonet/index.js';
import { buildFigure, refreshFigure } from './figure.js';

registerKind('stereonet', stereonetCore(bearing).compoKind());

const download = (blob, name) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
const fileName = (s) => String(s || 'figure').replace(/[^\w.-]+/g, '_');

export function createFigures({ project: p, layout, onStatus = () => {} }) {
  const editors = new Map();   // figureId → compo editor
  const tabId = (id) => 'fig:' + id;

  layout.registerPanel('fig:', {
    render(tab) {
      const f = p.figure(tab.figureId), host = document.createElement('div'); host.className = 'wfig-host';
      if (!f) return host;
      const ed = mountEditor(host, f.doc, {
        onChange: (doc) => p.setFigureDoc(f.id, doc),
        onStatus,
        toolbar: [
          { label: '↻ from the net', title: 'make the net, legend, statistics and caption again from the diagram as it is now (your layout stays)', run: (e) => {
            if (!p.diagram(f.from)) { onStatus('the diagram this figure was made from is gone'); return; }
            e.setDoc(refreshFigure(p, e.getDoc(), f.from)); p.setFigureDoc(f.id, e.getDoc()); onStatus('figure made again from the net');
          } },
          { label: 'Export PDF', title: 'a vector PDF of the page', run: async (e) => { download(new Blob([await exportPDF(e.getDoc(), { title: f.name, creator: 'wuffle' })], { type: 'application/pdf' }), `${fileName(f.name)}.pdf`); } },
          { label: 'Export PNG', title: 'the page as a picture', run: async (e) => { download(await exportPNG(e.getDoc(), { dpi: 200 }), `${fileName(f.name)}.png`); } },
        ],
      });
      editors.set(f.id, ed);
      return host;
    },
    destroy(tab) { editors.get(tab.figureId)?.destroy(); editors.delete(tab.figureId); },
  });

  /** a figure of the active net (or the one given) → its id; opens its tab */
  function newFigure(diagramId = p.activeDiagram) {
    const g = p.diagram(diagramId); if (!g) throw new Error('no diagram');
    const id = p.addFigure({ name: `${g.name} · figure`, doc: buildFigure(p, diagramId), from: diagramId });
    open(id);
    return id;
  }
  function open(id) {
    const f = p.figure(id); if (!f) return;
    if (!layout.hasTab(tabId(id))) layout.addTab({ id: tabId(id), title: f.name, closeable: true, figureId: id });
    layout.rails.activateTab(tabId(id));
  }
  p.on((e) => {
    if (['figure-removed', 'project-loaded', 'history'].includes(e.type)) for (const id of [...editors.keys()]) if (!p.figure(id)) layout.closeTab(tabId(id));
    if (e.type === 'history') for (const [id, ed] of editors) { const f = p.figure(id); if (f && JSON.stringify(f.doc) !== JSON.stringify(ed.getDoc())) ed.setDoc(f.doc); }   // an undone figure edit shows
  });
  return { newFigure, open, editors };
}
