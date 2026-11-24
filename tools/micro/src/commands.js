// micro commands — the registries features contribute to: the palette's COMMANDS (⌘K, src/palette.js)
// and extra rows for the menubar (src/menubar.js). A leaf: it imports nothing from the features, so
// any module can register at load time without joining an import cycle.
//
// A command: { id, group, title, kw?, hint?, when?(ctx), run(ctx) } — `when` hides it where it makes no
// sense (ctx = commandCtx(): the active layer, the layers, the project). Every menu verb needs one
// (test/micro-palette.test.mjs).
import { S, activeLayer } from './state.js';

export const COMMANDS = [];                                // in palette order (ties in a search keep it)
const _rank = new Map();                                   // id → place in the palette's order
let _late = 0;

// registerCommands(list) — a feature's commands. registerCommands(list, { order: true }) — THE order
// (src/command-list.js): each entry takes its place by position, and a string entry is a SLOT for the
// command with that id, registered by its own module. A command no ordered list names goes after.
export function registerCommands(list, { order = false } = {}) {
  list.forEach((c, i) => {
    const id = typeof c === 'string' ? c : c.id;
    if (order) _rank.set(id, i);
    else if (!_rank.has(id)) _rank.set(id, 1e6 + _late++);
    if (typeof c === 'string') return;
    const k = COMMANDS.findIndex((x) => x.id === id);
    if (k >= 0) COMMANDS[k] = c; else COMMANDS.push(c);
  });
  COMMANDS.sort((a, b) => _rank.get(a.id) - _rank.get(b.id));
}

// what a command's when / run are handed
export const commandCtx = () => ({ L: activeLayer(), layers: S.layers, project: S.project });

// ── the menubar's extra rows: contributeMenu('view', () => [ …menu items… ]) adds them at the end of
// that menu (file · view · data · tools · help), after a separator; built each time the menu opens ──
const _menus = new Map();
export function contributeMenu(menu, items) {
  if (!_menus.has(menu)) _menus.set(menu, []);
  _menus.get(menu).push(items);
}
export function menuContributions(menu) {
  const out = [];
  for (const fn of _menus.get(menu) || []) out.push(...(typeof fn === 'function' ? fn() : fn));
  return out.length ? [{ sep: true }, ...out] : [];
}
