// The rails host — @gcu/rails arranges surface iframes as docked tabs and
// floats. A surface tab's panel is the surface's iframe; rails never
// reparents it, so the iframe and its A-Bus connection survive every drag.
//
// The rails layout is persisted (debounced) to /home/.works/layout.json
// and restored at boot (auditable-works-spec §12.2).

import { createRails, findTab } from '#rails';
import { Menu } from '#menu';
import { WKS } from './state.js';
import { createSurface, spawnSurface, moveTabToPanel, moveTabToMain } from './surfaces.js';

const LAYOUT_PATH = '/home/.works/layout.json';
let _saveTimer = null;

export function setupLayout() {
  const el = document.getElementById('works-rails');

  WKS.rails = createRails(el, {
    initialState: { root: null, floats: [] },
    newTabButton: true,   // "+" at the end of every strip → opens the Launcher

    renderPanel(tab) {
      if (tab.kind === 'surface') {
        let rec = WKS.surfaces.get(tab.id);
        if (!rec && tab.surfaceKind) {
          // A tab restored from a saved layout — create its surface now.
          rec = createSurface(tab.id, tab.surfaceKind,
            { path: tab.path, title: tab.title });
        }
        if (rec) return rec.iframe;
      }
      const d = document.createElement('div');
      d.className = 'works-panel-placeholder';
      d.textContent = tab.title || 'surface';
      return d;
    },

    renderEmpty() {
      const d = document.createElement('div');
      d.className = 'works-empty';
      const p = document.createElement('p');
      p.textContent = 'No surfaces open.';
      const hint = document.createElement('p');
      hint.className = 'works-empty-hint';
      hint.textContent = 'Open a project from the sidebar, or:';
      const btn = document.createElement('button');
      btn.className = 'works-empty-launcher';
      btn.textContent = '✦  Launcher';
      btn.addEventListener('click', () => { try { WKS.spawnSurface('launcher', { title: 'Launcher' }); } catch { /* */ } });
      d.append(p, hint, btn);
      return d;
    },
  });

  // Persist the layout (debounced) whenever it changes. `layout:change`
  // covers adds / removes / moves / resizes; `tab:activate` (clicking a
  // tab to switch active) is a separate event that rails doesn't roll
  // into layout:change. Without saving on activate too, switching tabs
  // never reaches disk and reloads pop back to whichever tab was active
  // at the last add/remove.
  const _scheduleSave = () => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveLayout, 250);
  };
  WKS.rails.on('layout:change', _scheduleSave);
  WKS.rails.on('tab:activate',  _scheduleSave);

  // The strip "+" button → a Launcher in THAT stack (the user's "what next?"
  // entry point, per-tab-bar). spawnSurface targets the originating stack so
  // the launcher lands where the click was, not in some default stack.
  WKS.rails.on('strip:newtab', ({ stack }) => {
    try { spawnSurface('launcher', { title: 'Launcher' }, { to: 'stack', stackId: stack.id }); }
    catch (e) { console.warn('[works] strip:newtab launch failed:', e); }
  });

  // Right-click a tab: the split / panel / float moves, without dragging.
  WKS.rails.on('tab:contextmenu', ({ tab, x, y }) => {
    showTabMenu(tab.id, x, y).catch((e) => console.warn('[works] tab menu failed:', e));
  });
}

// The tab context menu. Splitting needs a second tab in the stack — moving
// a lone tab beside its own (then empty) stack would change nothing.
export async function showTabMenu(tabId, x, y) {
  const hit = findTab(WKS.rails.state, tabId);
  if (!hit) return;
  const docked = hit.container === 'dock';
  const alone = hit.stack.tabs.length === 1;
  const inPanel = docked && hit.stack.role === 'panel';
  const items = [];
  if (docked) {
    items.push(
      { label: 'Split right', action: 'split:right', disabled: alone },
      { label: 'Split down',  action: 'split:bottom', disabled: alone },
      '---',
      inPanel ? { label: 'Move to main area', action: 'to-main' }
              : { label: 'Move to bottom panel', action: 'to-panel' },
      { label: 'Float', action: 'float' },
    );
  } else {
    items.push({ label: 'Dock', action: 'to-main' }, { label: 'Move to bottom panel', action: 'to-panel' });
  }
  items.push('---',
    { label: 'Close', action: 'close' },
    { label: 'Close others', action: 'close-others', disabled: alone });

  const action = await Menu.show(items, { x, y });
  if (!action) return;
  if (action.startsWith('split:')) {
    WKS.rails.moveTab(tabId, { to: 'split', nodeId: hit.stack.id, side: action.slice(6) });
    WKS.rails.activateTab(tabId);
  }
  else if (action === 'to-panel') moveTabToPanel(tabId);
  else if (action === 'to-main')  moveTabToMain(tabId);
  else if (action === 'float')    WKS.rails.floatTab(tabId);
  else if (action === 'close')    WKS.rails.closeTab(tabId);
  else if (action === 'close-others') {
    for (const t of hit.stack.tabs.slice()) if (t.id !== tabId) WKS.rails.closeTab(t.id);
  }
}

// True when no tab is open anywhere (nothing docked, no float). Drives
// the boot "open the Launcher on an empty workspace" behavior.
export function isLayoutEmpty() {
  const st = WKS.rails && WKS.rails.state;
  if (!st) return true;
  // rails' cleanup drops empty stacks, so a non-null root has tabs.
  const floatHasTabs = (st.floats || []).some((f) => f.stack && (f.stack.tabs || []).length);
  return !st.root && !floatHasTabs;
}

async function saveLayout() {
  try {
    await WKS.vfs.writeFile(LAYOUT_PATH, WKS.rails.serialize());
  } catch { /* a transient VFS error — the next change retries */ }
}

// Restore the saved layout at boot. deserialize re-creates the rails tree;
// each tab's surface is created lazily by renderPanel on activation.
export async function restoreLayout() {
  try {
    if (!(await WKS.vfs.exists(LAYOUT_PATH))) return;
    const json = await WKS.vfs.readFile(LAYOUT_PATH, 'utf8');
    if (json) WKS.rails.deserialize(json);
  } catch (e) {
    console.error('Works: layout restore failed:', e);
  }
}
