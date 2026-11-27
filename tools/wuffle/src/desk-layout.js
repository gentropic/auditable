// wuffle desk — the layout: @gcu/rails with the tree on the left, one tab per DIAGRAM in the middle, the
// table below. Owns the diagram ↔ tab bookkeeping: a diagram added, renamed or removed in the project
// gets, renames or loses its tab; focusing a tab makes its diagram the active one.
//
// The arrangement travels WITH THE PROJECT (layout.json in the .zip.wuffle, so the autosave, a saved file
// and a saved page all reopen as they were left). It is kept by NAME, not by the session's ids: a tab is
// 'tree' | 'table' | 'stats' | 'console' | 'diagram:<name>' | 'figure:<name>'. On load, a tab whose diagram
// or figure isn't there is dropped, a diagram the layout doesn't mention gets a tab as it would anyway, and a
// layout that doesn't hold together falls back to the default one (View → Reset layout gives that too).

import { createRails, findTab, isSplit } from '../../../ext/rails/index.js';
import { NetView } from './desk-net.js';
import { RoseView, FabricView } from './desk-diagrams.js';

const tabOf = (g) => ({ id: 'diag:' + g.id, title: g.name, closeable: false, diagramId: g.id });
const FIXED = { tree: 'layers', table: 'table', stats: 'statistics', console: 'console' };
const fixedTab = (id) => ({ id, title: FIXED[id], closeable: false });
export const LAYOUT_VERSION = 1;

export function createLayout(host, { project: p, tree, table, stats, consoleView, select, rotate, measure, netMenu, onStatus }) {
  const views = new Map();   // diagramId → NetView
  const panels = new Map();  // tab-id prefix → { render(tab), destroy(tab) } — other modules' tabs (figures)
  const changed = new Set();
  if (!p.diagrams.length) p.addDiagram('net');

  const defaultState = () => ({ root: { id: 'root', dir: 'row', children: [
    { id: 'sTree', tabs: [fixedTab('tree')], active: 'tree', size: 270 },
    { id: 'cMain', dir: 'col', flex: 1, children: [
      ...(p.diagrams.length ? [{ id: 'sNets', tabs: p.diagrams.map(tabOf), active: 'diag:' + (p.diagram(p.activeDiagram) ? p.activeDiagram : p.diagrams[0].id), flex: 3 }] : []),
      { id: 'sTable', tabs: [fixedTab('table'), fixedTab('stats'), fixedTab('console')], active: 'table', size: 230 },
    ] },
  ] }, floats: [] });

  const rails = createRails(host, {
    initialState: defaultState(),
    renderPanel(tab) {
      if (tab.id === 'tree') return tree.el;
      if (tab.id === 'table') return table.el;
      if (tab.id === 'stats') return stats.el;
      if (tab.id === 'console') return consoleView.el;
      for (const [pre, pn] of panels) if (tab.id.startsWith(pre)) return pn.render(tab);
      if (tab.diagramId) {
        const kind = p.diagram(tab.diagramId)?.kind;
        const v = kind === 'rose' ? new RoseView(p, tab.diagramId) : kind === 'fabric' ? new FabricView(p, tab.diagramId) : new NetView(p, tab.diagramId, { onStatus });
        views.set(tab.diagramId, v); if (kind === 'net') { select?.attach(v); rotate?.attach(v); measure?.attach(v); netMenu?.attach(v); } return v.el;
      }
      return document.createElement('div');
    },
    onPanelDestroy(tab) {
      for (const [pre, pn] of panels) if (tab.id.startsWith(pre)) { pn.destroy?.(tab); return; }
      if (tab.diagramId) { const v = views.get(tab.diagramId); if (v) { select?.detach(v); measure?.detach(v); v.destroy(); } views.delete(tab.diagramId); } },
  });
  rails.on('tab:activate', ({ tab }) => { if (tab.diagramId && p.activeDiagram !== tab.diagramId && p.diagram(tab.diagramId)) p.setActive(tab.diagramId); });
  // any change to the arrangement (a drag, a resize, a float, the tab in front) → whoever keeps the project
  let applying = false;
  const notify = () => { if (!applying) for (const fn of changed) fn(); };
  rails.on('layout:change', notify);
  rails.on('tab:activate', notify);

  // where a new tab goes: beside the diagrams, else beside the table, else wherever rails puts it
  const stackOf = (id) => { const hit = findTab(rails.state, id); return hit && hit.container === 'dock' ? hit.stack.id : null; };
  const netStack = () => { for (const g of p.diagrams) { const s = stackOf('diag:' + g.id); if (s) return s; } return null; };
  const place = (tab) => {
    const s = netStack(), t = stackOf('table');
    rails.addTab(tab, s ? { to: 'stack', stackId: s } : t ? { to: 'split', nodeId: t, side: 'top' } : undefined);
  };
  const sync = () => {
    for (const id of [...views.keys()]) if (!p.diagram(id)) {
      const hit = findTab(rails.state, 'diag:' + id);
      if (hit) { hit.tab.closeable = true; rails.closeTab('diag:' + id); }   // closeable:false is for the user, not for us
    }
    for (const g of p.diagrams) {
      const id = 'diag:' + g.id, hit = findTab(rails.state, id);
      if (!hit) place(tabOf(g));
      else if (hit.tab.title !== g.name) rails.updateTab(id, { title: g.name });
    }
    // the four fixed panels are always somewhere (a saved layout that lost one gets it back beside the table)
    for (const id of Object.keys(FIXED)) if (!findTab(rails.state, id)) {
      const t = stackOf('table');
      rails.addTab(fixedTab(id), t && id !== 'tree' ? { to: 'stack', stackId: t } : undefined);
    }
  };

  // ── the arrangement by name ───────────────────────────────────────────────
  const keyOf = (tab) => {
    if (FIXED[tab.id]) return tab.id;
    if (tab.diagramId) { const g = p.diagram(tab.diagramId); return g ? 'diagram:' + g.name : null; }
    if (tab.figureId) { const f = p.figure(tab.figureId); return f ? 'figure:' + f.name : null; }
    return null;
  };
  const tabFor = (key) => {
    if (typeof key !== 'string') return null;
    if (FIXED[key]) return fixedTab(key);
    if (key.startsWith('diagram:')) { const g = p.diagrams.find((x) => x.name === key.slice(8)); return g ? tabOf(g) : null; }
    if (key.startsWith('figure:')) { const f = p.figures.find((x) => x.name === key.slice(7)); return f ? { id: 'fig:' + f.id, title: f.name, closeable: true, figureId: f.id } : null; }
    return null;
  };
  const SKIP = new Set(['tabs', 'active', 'children', 'stack']);
  const copyProps = (n) => Object.fromEntries(Object.entries(n).filter(([k, v]) => !SKIP.has(k) && (v == null || typeof v !== 'object')));
  /** rails' state → a plain, name-keyed description */
  function snapshot() {
    const stack = (s) => {
      const tabs = s.tabs.map(keyOf).filter(Boolean); if (!tabs.length) return null;
      const act = s.tabs.find((t) => t.id === s.active); return { ...copyProps(s), tabs, active: (act && keyOf(act)) || tabs[0] };
    };
    const node = (n) => {
      if (!n) return null;
      if (isSplit(n)) { const children = n.children.map(node).filter(Boolean); return children.length ? { ...copyProps(n), children } : null; }
      return stack(n);
    };
    const floats = (rails.state.floats || []).map((f) => { const s = stack(f.stack); return s ? { ...copyProps(f), stack: s } : null; }).filter(Boolean);
    return { version: LAYOUT_VERSION, root: node(rails.state.root), floats };
  }
  /** a name-keyed description → rails' state (tabs that no longer exist dropped, the tree mended) → or null */
  function fromSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return null;
    const seen = new Set();
    const stack = (s) => {
      if (!s || !Array.isArray(s.tabs)) return null;
      const tabs = s.tabs.map(tabFor).filter((t) => t && !seen.has(t.id)); for (const t of tabs) seen.add(t.id);
      if (!tabs.length) return null;
      const act = tabFor(s.active);
      return { ...copyProps(s), tabs, active: act && tabs.some((t) => t.id === act.id) ? act.id : tabs[0].id };
    };
    const node = (n) => {
      if (!n || typeof n !== 'object') return null;
      if (Array.isArray(n.children)) {
        if (n.dir !== 'row' && n.dir !== 'col') return null;
        const children = n.children.map(node).filter(Boolean);
        if (!children.length) return null;
        if (children.length === 1) {                      // a split left with one child is that child, in the split's place
          const c = children[0]; delete c.flex; delete c.size;
          for (const k of ['flex', 'size']) if (n[k] != null) c[k] = n[k];
          return c;
        }
        return { ...copyProps(n), children };
      }
      return stack(n);
    };
    const root = node(snap.root);
    const floats = (Array.isArray(snap.floats) ? snap.floats : []).map((f) => { const s = stack(f.stack); return s ? { ...copyProps(f), stack: s } : null; }).filter(Boolean);
    if (!root && !floats.length) return null;
    return { root, floats };
  }
  /** the project's own layout, or the default (a project that has none, a layout that won't hold) → 'saved' | 'default' */
  function apply(snap) {
    applying = true;
    try {
      const st = snap ? fromSnapshot(snap) : null;
      if (st) {
        try { rails.deserialize(JSON.stringify(st)); sync(); return 'saved'; }
        catch (e) { onStatus?.(`the project's layout didn't fit (${e.message}) — the default one instead`); }
      }
      rails.deserialize(JSON.stringify(defaultState())); sync();
      return 'default';
    } finally { applying = false; }
  }

  p.on((e) => {
    if (e.type === 'project-loaded') { apply(p.layout || null); for (const v of views.values()) v.draw(); return; }
    if (['diagram-added', 'diagram-removed', 'diagram-changed', 'history'].includes(e.type)) sync();
  });

  return {
    rails, views,
    focusDiagram: (id) => rails.activateTab('diag:' + id),
    focusTable: () => rails.activateTab('table'),
    focusStats: () => rails.activateTab('stats'),
    focusConsole: () => rails.activateTab('console'),
    focusTree: () => rails.activateTab('tree'),
    redrawAll: () => { for (const v of views.values()) v.draw(); },
    registerPanel: (prefix, pn) => panels.set(prefix, pn),
    hasTab: (id) => !!findTab(rails.state, id),
    /** a tab beside the diagrams (a figure) */
    addTab: (tab) => place(tab),
    closeTab: (id) => { const hit = findTab(rails.state, id); if (hit) { hit.tab.closeable = true; rails.closeTab(id); } },
    /** the arrangement, by name (what the project file keeps) */
    snapshot,
    /** View → Reset layout */
    reset: () => { apply(null); notify(); },
    /** fn() after the arrangement changes (the autosave listens) */
    onChange: (fn) => changed.add(fn),
  };
}
