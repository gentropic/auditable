// micro keys — THE list of keyboard shortcuts. The in-app Help (Keyboard &
// mouse), the manual's key table (docs/index.html) and the printable card
// (docs/card.html) are all rendered from it — docs/sync-keys.mjs rewrites the
// two docs, and test/micro-keys.test.mjs fails when they drift, or when the
// single-key handler binds a key this list doesn't name (or the reverse).
//
//   keys   how the key is shown (one entry may show several keys)
//   does   what it does, as the manual and the in-app table say it
//   group  the table section
//   bind   the e.key values the single-key handler matches (null for a
//          combination handled elsewhere — ⌘K, ⌘Z, ⌘S, Ctrl+`)
//   card   { group, label } on the printable card (absent: not on the card)
export const KEY_GROUPS = ['view', 'section', 'tools', 'layers', 'everything else'];

export const KEYS = [
  { group: 'view', keys: ['f'], does: 'fit the data', bind: ['f'], card: { group: 'view', label: 'fit' } },
  { group: 'view', keys: ['o'], does: 'orthographic ⇄ perspective', bind: ['o'], card: { group: 'view', label: 'ortho ⇄ persp' } },
  { group: 'view', keys: ['d'], does: 'plan view (looking down)', bind: ['d'], card: { group: 'view', label: 'plan' } },
  { group: 'view', keys: ['u'], does: 'from below (looking up)', bind: ['u'], card: { group: 'view', label: 'from below' } },
  { group: 'view', keys: ['n', 's', 'e', 'w'], does: 'look level north / south / east / west', bind: ['n', 's', 'e', 'w'], card: { group: 'view', label: 'look that way', wide: true } },
  { group: 'view', keys: ['g', '1–9'], does: 'go to view slot 1–9 (g then ⇧digit saves the current view there; a bare digit does nothing)', bind: ['g'], card: { group: 'everything else', label: 'go to view slot' } },
  { group: 'section', keys: ['k', 'c'], does: 'knife / cut — drag a line for a vertical section (⇧ snaps 15°, ⇧⌥ 5°)', bind: ['k', 'c'], card: { group: 'section', label: 'knife / cut', note: 'drag a line · ⇧ snap 15° · ⇧⌥ 5°', wide: true } },
  { group: 'section', keys: ['x'], does: 'section on / off', bind: ['x'], card: { group: 'section', label: 'on / off' } },
  { group: 'section', keys: ['l'], does: 'face the section', bind: ['l'], card: { group: 'section', label: 'face it' } },
  { group: 'section', keys: ['⇧L'], does: 'face the section from behind', bind: ['L'], card: { group: 'section', label: 'its back' } },
  { group: 'section', keys: [',', '.'], does: 'step the section one slab back / forward', bind: [',', '.'], card: { group: 'section', label: 'step one slab' } },
  { group: 'section', keys: ['Ctrl wheel'], does: 'scrub the section', bind: null },
  { group: 'section', keys: ['Alt wheel'], does: 'slab thicker / thinner', bind: null },
  { group: 'tools', keys: ['/'], does: 'focus the filter box', bind: ['/'], card: { group: 'tools', label: 'filter' } },
  { group: 'tools', keys: ['m'], does: 'measure — then click two records', bind: ['m'], card: { group: 'tools', label: 'measure' } },
  { group: 'tools', keys: ['i'], does: 'file info — what was detected, and the mapping', bind: ['i'], card: { group: 'tools', label: 'file info' } },
  { group: 'tools', keys: ['t'], does: 'attribute table of the active layer', bind: ['t'], card: { group: 'tools', label: 'table' } },
  { group: 'tools', keys: ['r'], does: 'select by rectangle', bind: ['r'], card: { group: 'tools', label: 'rectangle' } },
  { group: 'tools', keys: ['v'], does: 'select by lasso', bind: ['v'], card: { group: 'tools', label: 'lasso' } },
  { group: 'tools', keys: ['b'], does: 'paint a column', bind: ['b'], card: { group: 'tools', label: 'paint' } },
  { group: 'tools', keys: ['Esc'], does: 'put the tool down, cancel, or clear the selection', bind: ['Escape'], card: { group: 'tools', label: 'cancel' } },
  { group: 'tools', keys: ['⇧P'], does: 'layer properties', bind: ['P'], card: { group: 'tools', label: 'properties' } },
  { group: 'layers', keys: ['p'], does: 'layers panel', bind: ['p'], card: { group: 'layers', label: 'panel' } },
  { group: 'layers', keys: ['[', ']'], does: 'step the active layer', bind: ['[', ']'], card: { group: 'layers', label: 'step active' } },
  { group: 'layers', keys: ['{', '}'], does: 'step through a mutually exclusive group', bind: ['{', '}'], card: { group: 'layers', label: 'step exclusive' } },
  { group: 'layers', keys: ['h'], does: 'hide / show the active layer', bind: ['h'], card: { group: 'layers', label: 'hide / show' } },
  { group: 'layers', keys: ['⇧H'], does: 'solo the active layer (again restores)', bind: ['H'], card: { group: 'layers', label: 'solo' } },
  { group: 'layers', keys: ['F2'], does: 'rename the active layer', bind: ['F2'], card: { group: 'layers', label: 'rename' } },
  { group: 'layers', keys: ['⇧B'], does: 'block edges on / off', bind: ['B'], card: { group: 'layers', label: 'block edges' } },
  { group: 'everything else', keys: ['⌘/Ctrl K'], does: 'command palette — every action, filtered to what applies', bind: null, card: { group: 'everything else', label: 'palette' } },
  { group: 'everything else', keys: ['⌘/Ctrl S'], does: 'save the project', bind: null, card: { group: 'everything else', label: 'save project' } },
  { group: 'everything else', keys: ['⌘/Ctrl Z'], does: 'undo — a paint stroke, a selection, a filter, a removed ƒ column or rule', bind: null, card: { group: 'everything else', label: 'undo' } },
  { group: 'everything else', keys: ['⌘/Ctrl Shift Z', 'Ctrl Y'], does: 'redo — what the last undo took back (a new edit clears it)', bind: null, card: { group: 'everything else', label: 'redo' } },
  { group: 'everything else', keys: ['Ctrl `'], does: 'cycle through the open windows', bind: null },
  { group: 'everything else', keys: ['F1'], does: 'keyboard & mouse help', bind: ['F1'] },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// the manual's table: one header row per group, key | action
export function keysManualHtml() {
  const rows = [];
  for (const g of KEY_GROUPS) {
    rows.push(`  <tr><th colspan="2">${esc(g)}</th></tr>`);
    for (const k of KEYS.filter((x) => x.group === g)) rows.push(`  <tr><td>${k.keys.map((c) => `<span class="kbd">${esc(c)}</span>`).join(' ')}</td><td>${esc(k.does)}</td></tr>`);
  }
  return `<table class="keys">\n${rows.join('\n')}\n</table>`;
}

// the card: one group's key/label pairs, in the card's own markup
export function keysCardHtml(group) {
  const kbd = (c) => (c === '1–9' ? '<kbd>1</kbd>–<kbd>9</kbd>' : `<kbd>${esc(c.replace('⌘/Ctrl ', '⌘'))}</kbd>`);
  return KEYS.filter((k) => k.card && k.card.group === group)
    .map((k) => `          <span class="kv${k.card.wide ? ' s2' : ''}"><span class="kk">${k.keys.map(kbd).join(k.keys.length > 1 && k.keys[0].length === 1 && !k.card.wide ? '' : ' ')}</span><b>${esc(k.card.label)}${k.card.note ? ` <span class="d">— ${esc(k.card.note)}</span>` : ''}</b></span>`)
    .join('\n');
}

// the in-app Help: a compact two-column grid, group by group
export function keysHelpHtml() {
  return KEY_GROUPS.map((g) => `<b>${esc(g)}</b><br>` + KEYS.filter((k) => k.group === g)
    .map((k) => `${k.keys.map((c) => `<code>${esc(c)}</code>`).join(' ')} ${esc(k.does)}`).join(' · ')).join('<br>');
}
