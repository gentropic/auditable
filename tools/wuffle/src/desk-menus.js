// wuffle desk — the menubar (@gcu/menu) and the keyboard shortcuts. Menus are built fresh each time they
// open (items reflect the project); every action is one named command, so a palette or the console can
// call the same thing later.

import { MenuBar } from '../../../ext/menu/index.js';
import { alert, confirm, prompt } from '../../../ext/dialog/index.js';
import { THEMES } from './desk-theme.js';
import { TOCHER } from './samples.js';

export const ABOUT = 'wuffle — a stereonet workbench and a field compass, one file, no network. Maths by @gcu/bearing, '
  + 'nets by @gcu/stereonet. In the line of OpenStereo (Grohmann & Campanha, 2009/10) and its 2016 rewrite. Sample data: '
  + 'Tocher, F. E. (1979), The computer contouring of fabric diagrams, Computers & Geosciences 5, 73–126.';

export function createMenus(host, { project: p, files, layout, theme, figures, onStatus }) {
  // a new diagram shows what the active one shows (views of the same data), so a rose of the net's sets is one click
  const newDiagram = (kind) => {
    const from = p.activeDiagram;
    const id = p.batch(`new ${kind}`, () => { const g = p.addDiagram(kind); if (from) for (const L of p.layersOf(from)) p.addView(L.id, g); return g; });
    p.setActive(id); layout.focusDiagram(id);
  };
  const commands = {
    undo: () => { const l = p.undo(); onStatus?.(l ? `undid ${l}` : 'nothing to undo'); },
    redo: () => { const l = p.redo(); onStatus?.(l ? `redid ${l}` : 'nothing to redo'); },
    open: () => files.pick(),
    savepage: () => files.savePage(),
    newproject: async () => { if (p.datasets.length && !(await confirm('Start a new, empty project? This one is gone unless you saved it (Undo can’t bring it back).', { okLabel: 'New project', danger: true }))) return; await files.newProject(); },
    tocher: () => files.addData(TOCHER, 'tocher.csv'),
    save: () => files.save(),
    newnet: () => newDiagram('net'),
    newrose: () => newDiagram('rose'),
    newfabric: () => newDiagram('fabric'),
    rmnet: () => { if (p.activeDiagram) p.removeDiagram(p.activeDiagram); },
    field: () => { const u = new URL(location.href); u.searchParams.delete('desk'); u.searchParams.set('field', ''); location.href = u.toString(); },
    // the build stamp is the page's own footer (the build writes it there; the desk hides the footer)
    about: () => { const v = (document.querySelector('.vfoot')?.textContent || '').trim(); return alert(ABOUT + '\n\n' + (v && !/__WUFFLE_BUILD__/.test(v) ? v : 'the development tree (unbuilt)')); },
    rename: async () => { const n = await prompt('Name of the project — files are saved under it', { defaultValue: p.name }); if (n && n.trim() && n.trim() !== p.name) { p.renameProject(n); onStatus?.(`the project is “${p.name}” — saved as ${p.name.replace(/[^\w.-]+/g, '_')}.zip.wuffle`); } },
    figure: async () => { try { figures.newFigure(); } catch (e) { await alert(e.message); } },
    figbook: async () => { try { await figures.exportBook(); } catch (e) { await alert(e.message); } },
    console: () => { layout.focusConsole(); setTimeout(() => document.querySelector('.wcon textarea')?.focus(), 0); },
  };
  const bar = new MenuBar(host, () => [
    { label: 'File', items: () => [
      { label: 'New project', action: 'newproject' },
      { label: 'Open data or a project…', action: 'open', shortcut: 'Ctrl+O' },
      { label: 'Open the tocher sample', action: 'tocher' },
      '---',
      { label: 'Rename project…', action: 'rename' },
      { label: 'Save project (.zip.wuffle)', action: 'save', shortcut: 'Ctrl+S' },
      { label: 'Save as page (one .html, the project inside)', action: 'savepage', disabled: !files.canSavePage() },
    ] },
    { label: 'Edit', items: () => [
      { label: p.canUndo() ? `Undo ${p.undoLabel()}` : 'Undo', action: 'undo', shortcut: 'Ctrl+Z', disabled: !p.canUndo() },
      { label: p.canRedo() ? `Redo ${p.redoLabel()}` : 'Redo', action: 'redo', shortcut: 'Ctrl+Shift+Z', disabled: !p.canRedo() },
    ] },
    { label: 'Diagram', items: () => [
      { label: 'New net', action: 'newnet' },
      { label: 'New rose diagram', action: 'newrose' },
      { label: 'New fabric plot', action: 'newfabric' },
      '---',
      { label: 'Remove the active diagram', action: 'rmnet', disabled: !p.activeDiagram, danger: true },
    ] },
    { label: 'Figure', items: () => [
      { label: 'New figure from the active diagram', action: 'figure', disabled: !p.diagram(p.activeDiagram) },
      { label: 'Export all figures as one PDF…', action: 'figbook', disabled: p.figures.length < 1, title: 'every figure, in the order listed, one per page: numbered on across the book, a footer with the page' },
      ...(p.figures.length ? ['---', ...p.figures.map((f) => ({ label: f.name, action: 'openfig:' + f.id }))] : []),
    ] },
    { label: 'View', items: () => [
      { label: 'Theme', children: THEMES.map(([k, t]) => ({ label: t, action: 'theme:' + k, checked: theme.pref === k, group: 'theme' })) },
      { label: 'Console', action: 'console', shortcut: '`' },
      '---',
      { label: 'Field mode (the compass)', action: 'field' },
    ] },
    { label: 'Help', items: () => [{ label: 'About wuffle', action: 'about' }] },
  ]);
  const run = async (a) => {
    if (a.startsWith('theme:')) theme.set(a.slice(6));
    else if (a.startsWith('openfig:')) figures.open(a.slice(8));
    else await commands[a]?.();
    bar.refresh();
  };
  bar.on('action', run);
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !document.body.classList.contains('desk')) return;
    if (e.key === 'o') { e.preventDefault(); run('open'); } else if (e.key === 's') { e.preventDefault(); run('save'); }
    // undo / redo — not while typing, and not inside a figure (compo has its own undo there)
    else if (/^[zy]$/i.test(e.key) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) && !e.target?.closest?.('.wfig-host')) {
      e.preventDefault(); run(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo');
    }
  });
  // ` opens the console (not while typing somewhere)
  addEventListener('keydown', (e) => {
    if (e.key !== '`' || e.ctrlKey || e.metaKey || !document.body.classList.contains('desk')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault(); run('console');
  });
  return { bar, run, commands };
}
