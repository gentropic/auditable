// wuffle desk — the menubar (@gcu/menu) and the keyboard shortcuts. Menus are built fresh each time they
// open (items reflect the project); every action is one named command, so a palette or the console can
// call the same thing later.

import { MenuBar } from '../../../ext/menu/index.js';
import { alert } from '../../../ext/dialog/index.js';
import { THEMES } from './desk-theme.js';
import { TOCHER } from './samples.js';

export const ABOUT = 'wuffle — a stereonet workbench and a field compass, one file, no network. Maths by @gcu/bearing, '
  + 'nets by @gcu/stereonet. In the line of OpenStereo (Grohmann & Campanha, 2009/10) and its 2016 rewrite. Sample data: '
  + 'Tocher, F. E. (1979), The computer contouring of fabric diagrams, Computers & Geosciences 5, 73–126.';

export function createMenus(host, { project: p, files, layout, theme }) {
  // a new diagram shows what the active one shows (views of the same data), so a rose of the net's sets is one click
  const newDiagram = (kind) => {
    const from = p.activeDiagram, id = p.addDiagram(kind);
    if (from) for (const L of p.layersOf(from)) p.addView(L.id, id);
    p.setActive(id); layout.focusDiagram(id);
  };
  const commands = {
    open: () => files.pick(),
    tocher: () => files.addData(TOCHER, 'tocher.csv'),
    save: () => files.save(),
    newnet: () => newDiagram('net'),
    newrose: () => newDiagram('rose'),
    newfabric: () => newDiagram('fabric'),
    rmnet: () => { if (p.activeDiagram) p.removeDiagram(p.activeDiagram); },
    field: () => { const u = new URL(location.href); u.searchParams.delete('desk'); u.searchParams.set('field', ''); location.href = u.toString(); },
    about: () => alert(ABOUT),
  };
  const bar = new MenuBar(host, () => [
    { label: 'File', items: () => [
      { label: 'Open data…', action: 'open', shortcut: 'Ctrl+O' },
      { label: 'Open the tocher sample', action: 'tocher' },
      '---',
      { label: 'Save project', action: 'save', shortcut: 'Ctrl+S' },
    ] },
    { label: 'Diagram', items: () => [
      { label: 'New net', action: 'newnet' },
      { label: 'New rose diagram', action: 'newrose' },
      { label: 'New fabric plot', action: 'newfabric' },
      '---',
      { label: 'Remove the active diagram', action: 'rmnet', disabled: !p.activeDiagram, danger: true },
    ] },
    { label: 'View', items: () => [
      { label: 'Theme', children: THEMES.map(([k, t]) => ({ label: t, action: 'theme:' + k, checked: theme.pref === k, group: 'theme' })) },
      '---',
      { label: 'Field mode (the compass)', action: 'field' },
    ] },
    { label: 'Help', items: () => [{ label: 'About wuffle', action: 'about' }] },
  ]);
  const run = async (a) => {
    if (a.startsWith('theme:')) theme.set(a.slice(6));
    else await commands[a]?.();
    bar.refresh();
  };
  bar.on('action', run);
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !document.body.classList.contains('desk')) return;
    if (e.key === 'o') { e.preventDefault(); run('open'); } else if (e.key === 's') { e.preventDefault(); run('save'); }
  });
  return { bar, run, commands };
}
