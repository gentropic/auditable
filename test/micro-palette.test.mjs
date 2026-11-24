// micro's command palette (⌘K, the COMMANDS registry in tools/micro/index.html) must
// not drift behind its menus: every menu item literal `{ label: '…', action: … }` in
// tools/micro/index.html and tools/micro/src/*.js needs a palette command whose title
// matches it — or an entry in the ALLOWLIST below saying why it doesn't.
//
// Static scan, no browser. What it can see: plain single-quoted label literals followed
// by `action:` (optionally `kbd: '…',` between). Computed labels (`(x ? '✓ ' : '') + '…'`,
// template literals) are invisible to it — those are toggles/dynamic rows, and stay a
// review concern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'micro');
const FILES = ['index.html', ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).sort().map((f) => 'src/' + f)];

// comparison key: case-, punctuation- and trailing-ellipsis-insensitive
const norm = (s) => s.toLowerCase().replace(/\\'/g, "'").replace(/[….]+$/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ── labels that are NOT palette commands, each with its reason ──
// (b) = the same verb is in the palette under another title; (c) = not a command
const ALLOWLIST = {
  // (b) covered under another title
  'Along the section': '(b) "Look along the section"',
  'Convert to .wfr…': '(b) "Convert files to .wfr…"',
  'Edit custom theme…': '(b) "Theme: edit a custom theme…"',
  'Extend to footprint…': '(b) "Extend surface to footprint…"',
  'Flag / ratio by this surface…': '(b) "Select by solid / surface…" (the same dialog)',
  'Select by this solid…': '(b) "Select by solid / surface…" (the same dialog)',
  'Layer properties…': '(b) "Properties…"',
  'Layers panel': '(b) "Toggle layers panel"',
  'Library… (routines without a project)': '(b) "Library…"',
  'New view beside it': '(b) "New view beside this layer"',
  'Paint to column…': '(b) "Paint column…"',
  'Plan (down)': '(b) "Plan view (looking down)"',
  'QA report…': '(b) "Drillhole QA report"',
  'Reload from disk': '(b) "Reload active layer from disk"',
  'Scatter / Q-Q…': '(b) "Scatter plot" + "Q-Q plot"',
  'Section series…': '(b) "Export a section series…"',
  'Turntable video…': '(b) "Record a turntable video…"',
  'To group…': '(b) "New group / move layer to group…"',
  'Panel root (leave the group)': '(b) "New group / move layer to group…" (offers it when grouped)',
  'Composite…': '(b) "Composite drillholes…"',
  'Fit': '(b) "Fit view"',
  'Cascade': '(b) "Cascade windows"',
  'Composer…': '(b) "Composer — lay out a page…"',
  'Touch…': '(b) "Touch help…"',
  'Open…': '(b) "Open file…"',

  // (c) not a command: a placeholder row, a heading, a dialog button, an item that acts on a
  // row/entry/window the palette has no handle on, or a submenu option of a verb that is in the palette
  '(load another grid to drape over it)': '(c) placeholder row',
  '(reading collar columns…)': '(c) placeholder row',
  'no open windows': '(c) placeholder row',
  'a project’s own recipes: open a project folder': '(c) hint row',
  'File': '(c) burger-menu heading', 'Data': '(c) burger-menu heading', 'Tools': '(c) burger-menu heading',
  'View': '(c) burger-menu heading', 'Help': '(c) burger-menu heading',
  'Bench scan — 2M points': '(c) dev sample loader', 'Bench scan — 10M points': '(c) dev sample loader',
  'Bench scan — 50M points': '(c) dev sample loader', 'Block model — 2M': '(c) dev sample loader',
  'Add to selection': '(c) swath band context menu', 'Keep highlight': '(c) swath band context menu', 'Clear': '(c) swath band context menu',
  'Custom…': '(c) a "Tint…" option',
  'Up': '(c) a layer / group Move submenu', 'Down': '(c) a layer / group Move submenu',
  'Rename group…': '(c) group context menu',
  'Ungroup (keep layers)': '(c) group context menu', 'Zoom to group': '(c) group context menu',
  'Delete': '(c) a recipe submenu', 'Edit (open configured)': '(c) a recipe submenu', 'Rename…': '(c) a recipe / legend entry submenu',
  'Run fresh (reuse nothing)': '(c) a routine submenu',
  'Duplicate': '(c) a style rule row', 'Remove': '(c) a rule / calc row',
  'Edit…': '(c) a calc column row', 'Split into entries': '(c) a legend entry', 'Ungroup': '(c) a legend entry', 'Remove (→ other)': '(c) a legend entry',
  'Remove value': '(c) a paint value row', 'Show all fields': '(c) the pick panel',
  'Use as category': '(c) a column row in Properties', 'Use as color channel': '(c) a column row in Properties',
  'Skip this layer': '(c) project-load dialog button',
  'holes test the section’s slab': '(c) a "Cut by sections" option',
  'method: minimum curvature': '(c) a "Re-desurvey set…" option', 'method: balanced tangential': '(c) a "Re-desurvey set…" option',
  'method: tangential': '(c) a "Re-desurvey set…" option', 'dip: auto-detect': '(c) a "Re-desurvey set…" option',
  'dip: positive down': '(c) a "Re-desurvey set…" option', 'dip: negative down': '(c) a "Re-desurvey set…" option',
};

function scan() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = src.indexOf('const COMMANDS = [');
  assert.ok(start >= 0, 'COMMANDS registry not found in tools/micro/index.html');
  const reg = src.slice(start, src.indexOf('\n];', start));
  const titles = [...reg.matchAll(/\{ id: '[\w-]+', group: '[^']*', title: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
  const menu = new Map();                                    // label → first file
  for (const f of FILES) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/\{ label: '((?:[^'\\$]|\\.){1,100})', (?:kbd: '[^']*', )?action:/g)) {
      const l = m[1].replace(/\\'/g, "'");
      if (/^(Cancel|OK|none|—)/.test(l)) continue;           // dialog buttons
      if (!menu.has(l)) menu.set(l, f);
    }
  }
  return { titles, menu };
}

// covered = a title equal to the label, or a label of two or more words that a longer title
// starts with ("Scan columns" → "Scan columns (stats)"). One-word labels must match exactly —
// "File" would otherwise be covered by "File info…", "Remove" by "Remove layer".
const covers = (title, label) => { const t = norm(title), l = norm(label); return t === l || (l.includes(' ') && t.startsWith(l + ' ')); };

test('the scan finds the registry and the menus', () => {
  const { titles, menu } = scan();
  assert.ok(titles.length > 100, `only ${titles.length} palette commands parsed`);
  assert.ok(menu.size > 100, `only ${menu.size} menu labels parsed`);
});

test('every menu action has a palette command (or an allowlisted reason)', () => {
  const { titles, menu } = scan();
  const missing = [];
  for (const [label, file] of menu) {
    if (Object.hasOwn(ALLOWLIST, label)) continue;
    if (titles.some((t) => covers(t, label))) continue;
    missing.push(`  ${label}   (${file})`);
  }
  assert.equal(missing.length, 0,
    `menu labels with no command-palette entry — add a COMMANDS entry in tools/micro/index.html (calling the menu's own function, with a matching when()), or allowlist it in test/micro-palette.test.mjs with a reason:\n${missing.join('\n')}`);
});

test('the allowlist carries no dead entries', () => {
  const { titles, menu } = scan();
  const dead = Object.keys(ALLOWLIST).filter((l) => !menu.has(l));
  assert.equal(dead.length, 0, `allowlisted labels no longer in any menu — drop them:\n  ${dead.join('\n  ')}`);
  const redundant = Object.keys(ALLOWLIST).filter((l) => menu.has(l) && titles.some((t) => covers(t, l)));
  assert.equal(redundant.length, 0, `allowlisted labels a palette command already covers — drop them:\n  ${redundant.join('\n  ')}`);
});
