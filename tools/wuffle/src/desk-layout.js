// wuffle desk — the layout: @gcu/rails with the tree on the left, one tab per DIAGRAM in the middle, the
// table below. Owns the diagram ↔ tab bookkeeping: a diagram added, renamed or removed in the project
// gets, renames or loses its tab; focusing a tab makes its diagram the active one.

import { createRails, findTab } from '../../../ext/rails/index.js';
import { NetView } from './desk-net.js';

const tabOf = (g) => ({ id: 'diag:' + g.id, title: g.name, closeable: false, diagramId: g.id });

export function createLayout(host, { project: p, tree, table, select, onStatus }) {
  const views = new Map();   // diagramId → NetView
  if (!p.diagrams.length) p.addDiagram('net');
  const rails = createRails(host, {
    initialState: { root: { id: 'root', dir: 'row', children: [
      { id: 'sTree', tabs: [{ id: 'tree', title: 'layers', closeable: false }], active: 'tree', size: 270 },
      { id: 'cMain', dir: 'col', flex: 1, children: [
        { id: 'sNets', tabs: p.diagrams.map(tabOf), active: 'diag:' + (p.activeDiagram || p.diagrams[0].id), flex: 3 },
        { id: 'sTable', tabs: [{ id: 'table', title: 'table', closeable: false }], active: 'table', size: 230 },
      ] },
    ] }, floats: [] },
    renderPanel(tab) {
      if (tab.id === 'tree') return tree.el;
      if (tab.id === 'table') return table.el;
      if (tab.diagramId) { const v = new NetView(p, tab.diagramId, { onStatus }); views.set(tab.diagramId, v); select?.attach(v); return v.el; }
      return document.createElement('div');
    },
    onPanelDestroy(tab) { if (tab.diagramId) { const v = views.get(tab.diagramId); if (v) { select?.detach(v); v.destroy(); } views.delete(tab.diagramId); } },
  });
  rails.on('tab:activate', ({ tab }) => { if (tab.diagramId && p.activeDiagram !== tab.diagramId && p.diagram(tab.diagramId)) p.setActive(tab.diagramId); });

  const netStack = () => { for (const g of p.diagrams) { const hit = findTab(rails.state, 'diag:' + g.id); if (hit) return hit.stack.id; } return null; };
  const sync = () => {
    for (const id of [...views.keys()]) if (!p.diagram(id)) {
      const hit = findTab(rails.state, 'diag:' + id);
      if (hit) { hit.tab.closeable = true; rails.closeTab('diag:' + id); }   // closeable:false is for the user, not for us
    }
    for (const g of p.diagrams) {
      const id = 'diag:' + g.id, hit = findTab(rails.state, id);
      if (!hit) { const s = netStack(); rails.addTab(tabOf(g), s ? { to: 'stack', stackId: s } : { to: 'split', nodeId: 'sTable', side: 'top' }); }
      else if (hit.tab.title !== g.name) rails.updateTab(id, { title: g.name });
    }
  };
  p.on((e) => {
    if (['diagram-added', 'diagram-removed', 'diagram-changed', 'project-loaded'].includes(e.type)) sync();
    if (e.type === 'project-loaded') for (const v of views.values()) v.draw();
  });

  return {
    rails, views,
    focusDiagram: (id) => rails.activateTab('diag:' + id),
    focusTable: () => rails.activateTab('table'),
    redrawAll: () => { for (const v of views.values()) v.draw(); },
  };
}
