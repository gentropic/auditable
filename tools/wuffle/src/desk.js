// wuffle DESK — the workbench (design of record: spec_inbox/wuffle-desk-spec.md). @gcu/rails lays it out:
// the tree on the left, one tab per diagram in the middle, the table below. @gcu/menu for the menubar and
// context menus, @gcu/dialog for properties and confirms, @gcu/loom for the table, @gcu/bearing draws.
// Switchboard tokens in both themes (basalt / equipment gray), following the system unless chosen.

import { createRails, findTab } from '../../../ext/rails/index.js';
import { MenuBar } from '../../../ext/menu/index.js';
import { alert } from '../../../ext/dialog/index.js';
import { Project } from './model.js';
import { readTable } from './io.js';
import { NetView } from './desk-net.js';
import { TreeView } from './desk-tree.js';
import { TableView } from './desk-table.js';
import { TOCHER } from './samples.js';

// data colours (not UI accents): mid-tone, readable on basalt and on equipment gray
const PALETTE = ['#e07a5f', '#3f97cc', '#7fae2e', '#b56fd0', '#d9a321', '#2fa891'];

const CSS = `
body.desk {
  --w-bg-deep:#0E1012; --w-bg:#15171A; --w-bg-raised:#1D2024; --w-bg-bright:#25282D;
  --w-text:#DDDCDA; --w-text-mid:#9E9C98; --w-text-soft:#83817E; --w-border:#2F3338; --w-border-soft:#24272B; --w-rule:#3A3E44;
  --w-orange:#FB9044; --w-blue:#008CD1; --w-green:#5CCB80; --w-yellow:#FFD73A; --w-red:#E75A51; --w-violet:#EC9FFF; --w-violet-soft:#2A212C; --w-orange-soft:#2E2119;
  --w-net-bg:#101215; --w-net-grid:#2A2E33; --w-net-rim:#8A8884;
  --w-mono:'Space Mono','JetBrains Mono',Consolas,monospace; --w-sans:'Barlow',system-ui,sans-serif;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) body.desk {
  --w-bg-deep:#C2C1BE; --w-bg:#D2D1CE; --w-bg-raised:#E4E3E1; --w-bg-bright:#EDECEB;
  --w-text:#232322; --w-text-mid:#504F4C; --w-text-soft:#5A5856; --w-border:#B3B1AD; --w-border-soft:#C6C4C1; --w-rule:#A5A3A0;
  --w-orange:#8B3F00; --w-blue:#005C97; --w-green:#00602B; --w-yellow:#6F5700; --w-red:#99191E; --w-violet:#793A8D; --w-violet-soft:#F2DFF7; --w-orange-soft:#FDE0CF;
  --w-net-bg:#F4F3F1; --w-net-grid:#D3D1CD; --w-net-rim:#5A5856; color-scheme: light; } }
:root[data-theme="light"] body.desk {
  --w-bg-deep:#C2C1BE; --w-bg:#D2D1CE; --w-bg-raised:#E4E3E1; --w-bg-bright:#EDECEB;
  --w-text:#232322; --w-text-mid:#504F4C; --w-text-soft:#5A5856; --w-border:#B3B1AD; --w-border-soft:#C6C4C1; --w-rule:#A5A3A0;
  --w-orange:#8B3F00; --w-blue:#005C97; --w-green:#00602B; --w-yellow:#6F5700; --w-red:#99191E; --w-violet:#793A8D; --w-violet-soft:#F2DFF7; --w-orange-soft:#FDE0CF;
  --w-net-bg:#F4F3F1; --w-net-grid:#D3D1CD; --w-net-rim:#5A5856; color-scheme: light; }
/* the GCU components read their own variables: map them onto ours (here, so they win over the defaults' :root) */
body.desk {
  --rails-bg:var(--w-bg-deep); --rails-surface:var(--w-bg-raised); --rails-chrome:var(--w-bg-bright); --rails-border:var(--w-border);
  --rails-border-strong:var(--w-rule); --rails-text:var(--w-text); --rails-text-dim:var(--w-text-mid); --rails-text-faint:var(--w-text-soft);
  --rails-accent:var(--w-orange); --rails-accent-bg:var(--w-orange-soft); --rails-danger:var(--w-red); --rails-font-mono:var(--w-mono);
  --ui-bg:var(--w-bg-raised); --ui-bg-raised:var(--w-bg-raised); --ui-bg-hover:var(--w-bg-bright); --ui-bg-selected:var(--w-violet-soft);
  --ui-fg:var(--w-text); --ui-fg-muted:var(--w-text-mid); --ui-fg-error:var(--w-red); --ui-fg-accent:var(--w-orange);
  --ui-border:var(--w-border); --ui-border-focus:var(--w-blue); --ui-font:var(--w-sans); --ui-font-size:13px;
  margin:0; max-width:none; padding:0; height:100vh; background:var(--w-bg); color:var(--w-text); font:13px/1.4 var(--w-sans); overflow:hidden;
}
body.desk > [hidden] { display:none !important; }   /* the field page's own display rules would beat [hidden] */
#wdesk { height:100vh; display:grid; grid-template-rows:30px 1fr 22px; }
#wdesk .wbar { display:flex; align-items:center; gap:6px; padding:0 8px; background:var(--w-bg-raised); border-bottom:1px solid var(--w-border); }
#wdesk .wbrand { font:700 12px var(--w-mono); color:var(--w-orange); margin-right:8px; }
#wdesk .wmenus { flex:1; min-width:0; }
#wdesk .wsealed { font:11px var(--w-mono); color:var(--w-green); border:1px solid var(--w-border); border-radius:3px; padding:0 6px; }
#wdesk .wwork { min-height:0; position:relative; }
#wdesk .wstatus { display:flex; gap:18px; align-items:center; padding:0 10px; font:11px var(--w-mono); color:var(--w-text-soft); background:var(--w-bg-raised); border-top:1px solid var(--w-border); white-space:nowrap; overflow:hidden; }
#wdesk .wstatus .wst-hover { flex:1; overflow:hidden; text-overflow:ellipsis; }
.wn-host { flex:1; min-height:0; display:grid; place-items:center; background:var(--w-net-bg); outline:none; }
.wn-host svg { display:block; cursor:crosshair; }
.wtree { flex:1; min-height:0; overflow:auto; padding:6px 4px; font:13px var(--w-sans); background:var(--w-bg-raised); }
.wtree .wrow { display:flex; align-items:center; gap:6px; padding:3px 6px; border-radius:3px; cursor:default; user-select:none; }
.wtree .wrow:hover { background:var(--w-bg-bright); }
.wtree .wdiag { font-weight:500; margin-top:4px; }
.wtree .wdiag.active { font-weight:700; color:var(--w-text); box-shadow:inset 2px 0 0 var(--w-orange); }
.wtree .wdiag.drop { outline:1px dashed var(--w-violet); background:var(--w-violet-soft); }
.wtree .wlayer { padding-left:16px; }
.wtree .wel { padding-left:44px; color:var(--w-text-mid); padding-block:1px; }
.wtree .wel2 { padding-left:62px; }
.wtree .wname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wtree .wn { font:10.5px var(--w-mono); color:var(--w-text-soft); }
.wtree .wlink { font:10.5px var(--w-mono); color:var(--w-violet); }
.wtree .wico { color:var(--w-text-mid); width:12px; text-align:center; }
.wtree .wtw { width:12px; flex:0 0 auto; border:0; background:none; color:var(--w-text-soft); font-size:10px; padding:0; cursor:pointer; }
.wtree .wsw { width:10px; height:10px; border-radius:50%; flex:0 0 auto; }
.wtree .wsec { font:10.5px var(--w-mono); letter-spacing:.08em; text-transform:uppercase; color:var(--w-text-soft); padding:12px 6px 4px; border-top:1px solid var(--w-border-soft); margin-top:10px; }
.wtree .wempty { color:var(--w-text-soft); padding:4px 8px; font-size:12px; }
.wtree .wdata { padding-left:6px; }
.wcb { width:13px; height:13px; flex:0 0 auto; border:1px solid var(--w-text-mid); border-radius:2px; background:transparent; padding:0; position:relative; cursor:pointer; }
.wcb.on { background:var(--w-orange); border-color:var(--w-orange); }
.wcb.on::after { content:""; position:absolute; left:3.5px; top:0.5px; width:3px; height:7px; border:solid var(--w-bg-deep); border-width:0 2px 2px 0; transform:rotate(45deg); }
.wcb.partial::after { content:""; position:absolute; left:2px; right:2px; top:5px; height:2px; background:var(--w-orange); }
.wcb:focus-visible, .wtw:focus-visible { outline:2px solid var(--w-blue); outline-offset:1px; }
.wt-host { flex:1; min-height:0; display:flex; flex-direction:column; background:var(--w-bg-raised); }
.wt-head { font:11px var(--w-mono); color:var(--w-text-mid); padding:3px 8px; border-bottom:1px solid var(--w-border); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wt-body { flex:1; min-height:0; position:relative; }
.wprow { display:grid; grid-template-columns:130px 1fr; align-items:center; gap:10px; margin:6px 0; color:var(--w-text-mid); }
.wprow input, .wprow select { font:12px var(--w-mono); background:var(--w-bg-bright); color:var(--w-text); border:1px solid var(--w-border); border-radius:3px; padding:2px 6px; }
.wprow input[type=color] { padding:0; height:24px; width:60px; }
.wpnote { margin:0 0 8px; font:11px var(--w-mono); color:var(--w-text-soft); }
.wpbar { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
.wpbar button { font:12px var(--w-sans); padding:3px 12px; border-radius:3px; border:1px solid var(--w-border); background:var(--w-bg-bright); color:var(--w-text); cursor:pointer; }
.wpbar button.primary { background:var(--w-orange); border-color:var(--w-orange); color:var(--w-bg-deep); font-weight:600; }
.wdrop { position:absolute; inset:0; display:grid; place-items:center; background:color-mix(in srgb, var(--w-bg-deep) 70%, transparent); border:2px dashed var(--w-violet); color:var(--w-text); font:14px var(--w-sans); z-index:50; pointer-events:none; }
`;

export function mountDesk() {
  // the field instrument's page is the same file: its elements stay, hidden (the desk never runs field.js)
  for (const el of [...document.body.children]) if (!/^(SCRIPT|STYLE)$/.test(el.tagName)) el.hidden = true;
  document.body.classList.add('desk');
  const st = document.createElement('style'); st.id = 'wdesk-css'; st.textContent = CSS; document.head.append(st);

  const p = new Project({ name: 'untitled' });
  const root = document.createElement('div'); root.id = 'wdesk';
  root.innerHTML = '<div class="wbar"><span class="wbrand">wuffle</span><div class="wmenus"></div><span class="wsealed" title="no network: nothing leaves this page">● sealed</span></div>'
    + '<div class="wwork"></div><div class="wstatus"><span class="wst-count"></span><span class="wst-hover"></span><span class="wst-theme"></span></div>';
  document.body.append(root);
  const $ = (s) => root.querySelector(s);
  const status = { count: $('.wst-count'), hover: $('.wst-hover'), theme: $('.wst-theme') };

  // ── theme: system / basalt / equipment gray (remembered per viewer) ──
  const media = matchMedia('(prefers-color-scheme: dark)');
  let themePref = 'system'; try { themePref = localStorage.getItem('wuffle.theme') || 'system'; } catch { /* private */ }
  const views = new Map();   // diagramId → NetView
  const applyTheme = () => {
    const r = document.documentElement;
    if (themePref === 'system') delete r.dataset.theme; else r.dataset.theme = themePref;
    r.dataset.resolvedTheme = themePref === 'system' ? (media.matches ? 'dark' : 'light') : themePref;
    status.theme.textContent = themePref === 'system' ? `system · ${r.dataset.resolvedTheme}` : themePref === 'dark' ? 'basalt' : 'equipment gray';
    for (const v of views.values()) v.draw();
    table?.grid?.setColors(table._colors());
  };
  media.addEventListener('change', applyTheme);

  // colours: a layer without one gets the next palette colour, so tree and net agree
  p.on((e) => { if (e.type === 'layer-added') { const L = p.layer(e.id); if (!L.style.color) L.style.color = PALETTE[(p.layers.length - 1) % PALETTE.length]; } });

  const tree = new TreeView(p, {
    onShowDataset: (id) => { table.show(id); rails.activateTab('table'); },
    onFocusDiagram: (id) => rails.activateTab('diag:' + id),
    colorOf: (L) => L.style.color,
  });
  const table = new TableView(p);

  const diagTab = (g) => ({ id: 'diag:' + g.id, title: g.name, closeable: false, diagramId: g.id });
  p.addDiagram('net');
  const rails = createRails($('.wwork'), {
    initialState: { root: { id: 'root', dir: 'row', children: [
      { id: 'sTree', tabs: [{ id: 'tree', title: 'layers', closeable: false }], active: 'tree', size: 270 },
      { id: 'cMain', dir: 'col', flex: 1, children: [
        { id: 'sNets', tabs: p.diagrams.map(diagTab), active: 'diag:' + p.diagrams[0].id, flex: 3 },
        { id: 'sTable', tabs: [{ id: 'table', title: 'table', closeable: false }], active: 'table', size: 230 },
      ] },
    ] }, floats: [] },
    renderPanel(tab) {
      if (tab.id === 'tree') return tree.el;
      if (tab.id === 'table') return table.el;
      if (tab.diagramId) { const v = new NetView(p, tab.diagramId, { onStatus: (s) => { status.hover.textContent = s; } }); views.set(tab.diagramId, v); return v.el; }
      const d = document.createElement('div'); return d;
    },
    onPanelDestroy(tab) { if (tab.diagramId) { views.get(tab.diagramId)?.destroy(); views.delete(tab.diagramId); } },
  });
  rails.on('tab:activate', ({ tab }) => { if (tab.diagramId && p.activeDiagram !== tab.diagramId && p.diagram(tab.diagramId)) p.setActive(tab.diagramId); });

  // diagrams ↔ tabs
  const netStack = () => { for (const g of p.diagrams) { const hit = findTab(rails.state, 'diag:' + g.id); if (hit) return hit.stack.id; } return null; };
  const syncTabs = () => {
    for (const g of p.diagrams) {
      const id = 'diag:' + g.id, hit = findTab(rails.state, id);
      if (!hit) { const s = netStack(); rails.addTab(diagTab(g), s ? { to: 'stack', stackId: s } : { to: 'split', nodeId: 'sTable', side: 'top' }); }
      else if (hit.tab.title !== g.name) rails.updateTab(id, { title: g.name });
    }
    for (const v of [...views.keys()]) if (!p.diagram(v)) rails.closeTab('diag:' + v);   // closeable:false is for the user, not for us
  };
  p.on((e) => {
    if (['diagram-added', 'diagram-removed', 'diagram-changed', 'project-loaded'].includes(e.type)) {
      for (const [id] of views) if (!p.diagram(id)) { const t = findTab(rails.state, 'diag:' + id); if (t) { t.tab.closeable = true; rails.closeTab('diag:' + id); } }
      syncTabs();
    }
    if (e.type === 'project-loaded') { table.show(null); for (const v of views.values()) v.draw(); }
    const n = p.datasets.reduce((a, d) => a + d.rows.length, 0), s = [...p.selection.values()].reduce((a, x) => a + x.size, 0);
    status.count.textContent = `${p.datasets.length} dataset${p.datasets.length === 1 ? '' : 's'} · ${n} measurements${s ? ` · ${s} selected` : ''}`;
  });
  status.count.textContent = '0 datasets';

  // ── opening things ──
  const addData = (text, name) => {
    const specs = readTable(text, name.replace(/\.[^.]+$/, ''));
    let first = null;
    for (const s of specs) {
      const id = p.addDataset(s); first = first || id;
      if (!p.activeDiagram) p.addDiagram('net');
      p.addLayer(p.activeDiagram, id);
    }
    if (first) table.show(first);
    return specs;
  };
  const loadProject = (j) => {
    const q = Project.fromJSON(j);
    Object.assign(p, { name: q.name, datasets: q.datasets, diagrams: q.diagrams, layers: q.layers, selection: q.selection, activeDiagram: q.activeDiagram, _seq: q._seq });
    p._emit('project-loaded');
  };
  const openFiles = async (files) => {
    for (const f of files) {
      const text = await f.text();
      if (/\.(wuffle|json)$/i.test(f.name)) { try { loadProject(JSON.parse(text)); } catch (e) { await alert(`${f.name}: ${e.message}`); } continue; }
      addData(text, f.name);
    }
  };
  const picker = document.createElement('input'); picker.type = 'file'; picker.multiple = true; picker.accept = '.csv,.txt,.tsv,.dat,.wuffle,.json'; picker.hidden = true;
  picker.onchange = () => { openFiles([...picker.files]); picker.value = ''; };
  root.append(picker);
  let dropEl = null;
  root.addEventListener('dragover', (e) => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); if (!dropEl) { dropEl = document.createElement('div'); dropEl.className = 'wdrop'; dropEl.textContent = 'drop measurements or a .wuffle project'; $('.wwork').append(dropEl); } });
  root.addEventListener('dragleave', (e) => { if (e.target === root || !root.contains(e.relatedTarget)) { dropEl?.remove(); dropEl = null; } });
  root.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); dropEl?.remove(); dropEl = null; openFiles([...e.dataTransfer.files]); });
  const save = () => {
    const blob = new Blob([JSON.stringify(p.toJSON(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(p.name || 'untitled').replace(/[^\w.-]+/g, '_')}.wuffle`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  // ── the menubar ──
  const bar = new MenuBar($('.wmenus'), () => [
    { label: 'File', items: () => [
      { label: 'Open data…', action: 'open', shortcut: 'Ctrl+O' },
      { label: 'Open the tocher sample', action: 'tocher' },
      '---',
      { label: 'Save project', action: 'save', shortcut: 'Ctrl+S' },
    ] },
    { label: 'Diagram', items: () => [
      { label: 'New net', action: 'newnet' },
      { label: 'Remove the active net', action: 'rmnet', disabled: !p.activeDiagram, danger: true },
    ] },
    { label: 'View', items: () => [
      { label: 'Theme', children: [['system', 'System'], ['dark', 'Basalt (dark)'], ['light', 'Equipment gray (light)']].map(([k, t]) => ({ label: t, action: 'theme:' + k, checked: themePref === k, group: 'theme' })) },
      '---',
      { label: 'Field mode (the compass)', action: 'field' },
    ] },
    { label: 'Help', items: () => [{ label: 'About wuffle', action: 'about' }] },
  ]);
  const act = async (a) => {
    if (a === 'open') picker.click();
    else if (a === 'tocher') addData(TOCHER, 'tocher.csv');
    else if (a === 'save') save();
    else if (a === 'newnet') { const id = p.addDiagram('net'); p.setActive(id); rails.activateTab('diag:' + id); }
    else if (a === 'rmnet' && p.activeDiagram) p.removeDiagram(p.activeDiagram);
    else if (a.startsWith('theme:')) { themePref = a.slice(6); try { localStorage.setItem('wuffle.theme', themePref); } catch { /* private */ } applyTheme(); }
    else if (a === 'field') { const u = new URL(location.href); u.searchParams.delete('desk'); u.searchParams.set('field', ''); location.href = u.toString(); }
    else if (a === 'about') await alert('wuffle — a stereonet workbench and a field compass, one file, no network. Maths by @gcu/bearing. '
      + 'In the line of OpenStereo (Grohmann & Campanha, 2009/10) and its 2016 rewrite. Sample data: Tocher, F. E. (1979), The computer contouring of fabric diagrams, Computers & Geosciences 5, 73–126.');
    bar.refresh();
  };
  bar.on('action', act);
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'o') { e.preventDefault(); act('open'); } else if (e.key === 's') { e.preventDefault(); act('save'); }
  });

  applyTheme();
  const api = { project: p, rails, views, table, tree, addData, loadProject, open: openFiles, theme: (t) => act('theme:' + t) };
  window.__wuffleDesk = api;
  return api;
}
