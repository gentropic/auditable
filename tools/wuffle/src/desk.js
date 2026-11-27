// wuffle DESK — the workbench's composition root (design of record: spec_inbox/wuffle-desk-spec.md). It only
// wires the pieces; each lives in its own module:
//   model.js         the project (datasets once, layers as hard-linked views, selection on the data)
//   io.js            delimited text → datasets, never refusing; orientations
//   layers.js        wuffle's layers → @gcu/stereonet's plain layer inputs
//   desk-theme.js    system / basalt / equipment gray, and the net's look from the tokens
//   desk-layout.js   @gcu/rails: tree · one tab per diagram · table; diagram ↔ tab bookkeeping
//   desk-net.js      one net, drawn by @gcu/stereonet's core; pick + hover
//   desk-select.js   lasso / cone / band on a net, in attitude space (rotation-proof)
//   desk-rotate.js   drag a net to rotate it (arcball)
//   desk-netmenu.js  the net's right-click menu (what's under the cursor, the selection, export)
//   desk-tree.js     the tree: diagrams, layers, nested checkboxes, data; drag, menus, properties
//   desk-table.js    the table (@gcu/loom over a dataset's rows)
//   stats.js         statistics + derived datasets (pure)  ·  desk-stats.js  the statistics panel
//   commands.js      the console's language (pure)  ·  desk-console.js  the console panel
//   figure.js        a compo page from a net (pure)  ·  desk-figure.js   the figure editor
//   desk-files.js    open / drop / save, the project file
//   desk-menus.js    the menubar: every item runs the console's own command  ·  desk-ask.js  its forms
//   desk-keys.js     the keys and small gestures on the nets (R, arrows, Ctrl+A/C, Esc, PgUp/PgDn, ?, double-click)
//   desk.css         the styles, all under body.desk
import { Project } from './model.js';
import { nextColor } from './palette.js';
import { createTheme } from './desk-theme.js';
import { TreeView } from './desk-tree.js';
import { TableView } from './desk-table.js';
import { StatsView } from './desk-stats.js';
import { ConsoleView } from './desk-console.js';
import { createFigures } from './desk-figure.js';
import { TOCHER } from './samples.js';
import { createLayout } from './desk-layout.js';
import { createSelectTools } from './desk-select.js';
import { createRotate } from './desk-rotate.js';
import { createMeasure } from './desk-measure.js';
import { createNetMenu } from './desk-netmenu.js';
import { createFiles } from './desk-files.js';
import { createMenus } from './desk-menus.js';
import { createKeys } from './desk-keys.js';

export function mountDesk() {
  // the field compass's page is the same file: its elements stay, hidden (the desk never runs field.js)
  for (const el of [...document.body.children]) if (!/^(SCRIPT|STYLE)$/.test(el.tagName)) el.hidden = true;
  document.body.classList.add('desk');

  const root = document.createElement('div'); root.id = 'wdesk';
  root.innerHTML = '<div class="wbar"><span class="wbrand">wuffle</span><div class="wmenus"></div><span class="wposture" title="Runs entirely in this page. Nothing is fetched when it loads; only commands you type may reach the network (pkg install, a URL). Your project stays in this browser and in the files you save.">● local</span></div>'
    + '<div class="wwork"></div><div class="wstatus"><span class="wst-count"></span><span class="wst-hover"></span><span class="wst-theme"></span></div>';
  document.body.append(root);
  const $ = (s) => root.querySelector(s);

  const p = new Project({ name: 'untitled' });
  // a layer without a colour takes the next data colour, so the tree's swatch and the net agree
  p.on((e) => { if (e.type === 'layer-added') { const L = p.layer(e.id); if (!L.style.color) L.style.color = nextColor(p.layers.length - 1); } });

  const theme = createTheme();
  let layout = null;
  const table = new TableView(p);
  const tree = new TreeView(p, {
    onShowDataset: (id) => { table.show(id); layout.focusTable(); },
    onFocusDiagram: (id) => layout.focusDiagram(id),
    colorOf: (L) => L.style.color,
  });
  const stats = new StatsView(p, { onDerived: (id) => table.show(id) });
  const status = (s) => { $('.wst-hover').textContent = s; };
  const select = createSelectTools({ project: p, onStatus: status });
  const rotate = createRotate({ project: p, isActive: () => select.tool === 'pick' });
  const measure = createMeasure({ project: p, select, onStatus: status });
  let files = null;
  const consoleView = new ConsoleView({ project: p,
    // a typed selection goes through the active net's tool, so its shape is drawn too
    applyShape: (shape, mode) => { const v = layout.views.get(p.activeDiagram); return v && v.net ? select.apply(v, shape, mode) : null; },
    setTheme: (t) => theme.set(t), focusDiagram: (id) => layout.focusDiagram(id), openSample: () => files.addData(TOCHER, 'tocher.csv'),
    download: (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); } });
  // the net's right-click: what's under the cursor, the selection, the net, the picture (desk-netmenu.js)
  const netMenu = createNetMenu({ project: p, tree, table, select, measure, layout: { focusTable: () => layout.focusTable() }, commands: consoleView.cmd, onStatus: status });
  measure.setMenu((view, e, opts) => netMenu.show(view, e, opts));   // the measure tool's right click: its items, then the net's
  layout = createLayout($('.wwork'), { project: p, tree, table, stats, consoleView, select, rotate, measure, netMenu, onStatus: status });
  const figures = createFigures({ project: p, layout, onStatus: status });
  files = createFiles(root, { project: p, dropHost: $('.wwork'), onOpened: (id) => table.show(id), home: consoleView.home, layoutOf: () => layout.snapshot(), onStatus: status });
  layout.onChange(() => files.touch());          // the arrangement is the project's too: a drag or a tab switch autosaves
  const menus = createMenus($('.wmenus'), { project: p, files, layout, theme, figures, tree, table, select, netMenu, consoleView, onStatus: status });
  const keys = createKeys({ project: p, layout, select, table, menus, onStatus: status });
  tree.onOpenFigure = (id) => figures.open(id);
  tree.onCommand = (line) => consoleView.cmd.run(line);   // the tree's menu runs the console's own commands (export …)

  // the tab's title names the project, as a saved page's own <title> does (page.js): "<name> — wuffle"
  const title = () => { document.title = `${p.name || 'untitled'} — wuffle`; };
  p.on((e) => {
    if (e.type === 'project-loaded') table.show(null);
    if (e.type === 'project-loaded' || e.type === 'project-renamed' || e.type === 'history') title();
    const n = p.datasets.reduce((a, d) => a + d.rows.length, 0), s = [...p.selection.values()].reduce((a, x) => a + x.size, 0);
    $('.wst-count').textContent = `${p.datasets.length} dataset${p.datasets.length === 1 ? '' : 's'} · ${n} measurements${s ? ` · ${s} selected` : ''}`;
  });
  $('.wst-count').textContent = '0 datasets · 0 measurements';
  theme.onChange(() => { $('.wst-theme').textContent = theme.label(); layout.redrawAll(); table.applyTheme(); });
  theme.apply();

  const api = { project: p, layout, keys, rails: layout.rails, views: layout.views, table, tree, menus, theme, select, measure, netMenu, stats, console: consoleView, figures, files,
    addData: files.addData, loadProject: files.loadProject, open: files.open, setTheme: (t) => theme.set(t),
    restored: files.restore() };                       // the last session, from this browser's autosave (a promise → true / false)
  window.__wuffleDesk = api;
  return api;
}
