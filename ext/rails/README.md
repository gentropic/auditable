# @gcu/rails

> Part of the **Switchboard** UI toolkit (a tier-2 DOM component) — themed via `--au-*` tokens per the authoring contract (`ext/switchboard/SPEC.md` §6.0).

Layout engine for docked tab-based workspaces with floating groups.

Tab stacks in a tree of row and column splits, plus floats — no OS popout. Panels never reparent, so iframes, canvases, focused inputs, and running media survive every drag.

Zero dependencies. The library is ~13 KB minified + gzipped; the structural CSS ~2.8 KB gzipped.

Part of [Auditable](https://github.com/gentropic/auditable). Designed first for the Auditable Works workspace shell.

Pre-1.0 — APIs may break on minor version bumps. 0.4 replaced the two-level `rails`/`stacks` state with a split tree (`root`); old layouts still load (converted on `createRails` / `deserialize`).

## Install

```sh
npm install @gcu/rails
```

## Usage

```js
import { createRails } from '@gcu/rails';
import '@gcu/rails/rails.css';

const rails = createRails(document.getElementById('workspace'), {
  initialState: {
    root: {
      id: 's1', active: 'a',
      tabs: [
        { id: 'a', title: 'notes' },
        { id: 'b', title: 'output' }
      ]
    },
    floats: []
  },
  renderPanel(tab) {
    const el = document.createElement('div');
    el.textContent = `panel for ${tab.title}`;
    return el;
  }
});
```

Drag tabs between strips; drop near a panel's edge to split it there, on the workspace rim for a row or column spanning everything, or on a resize bar to slot in between. Bars resize. Panel contents persist across every move.

### Sizing your panel content

`.rails-panel` is `display: flex; flex-direction: column`. The element you return from `renderPanel(tab)` is its sole child — size it with `flex: 1; min-height: 0` to fill. Inner elements (iframes, canvases, textareas) typically need the same treatment to fill the outer.

```css
.my-panel-body {
  flex: 1;
  min-height: 0;
  /* then your own layout inside */
}
.my-panel-body iframe,
.my-panel-body canvas {
  flex: 1;
  min-height: 0;
  width: 100%;
}
```

Height fallbacks via `height: 100%` are unreliable inside flex containers — use `flex: 1; min-height: 0` instead.

## What's in this release

- **Split tree** — the docked area is any tree of row/column splits with tab stacks at the leaves; drop zones on every stack edge, on the workspace rim and on every resize bar; the tree normalizes itself as tabs move and close
- **Floats** — tear off tabs into draggable/resizable frames, 8 resize handles, maximize/minimize/close, redock by dragging the titlebar onto any docked drop zone, z-raise on focus. Floats are first-class mini-stacks: they accept multiple tabs (drop on titlebar, strip, or body), and the in-stack tab strip auto-hides when only one tab is present so the titlebar is the only chrome.
- **Panel preservation** — `closeTab(id, { preserve: true })` hides the panel instead of destroying it. Per-tab `preserveOnClose: true` flag routes UI close (× / Ctrl-W) through preserve. `releasePreservedPanel(id)` / `listPreservedPanels()` round out the lifecycle. Iframe, canvas, form state intact across close → re-open.
- **Tab overflow** — when the tab count exceeds the strip width, a `⋯` button appears at the right edge. Clicking emits `strip:overflow` with the list of clipped tabs and a screen-space anchor — consumer renders the menu UI.
- **Drag ergonomics** — hover-to-activate during drag (hold over an inactive tab for 500ms), auto-scroll overflowing strips when the drag cursor nears the edges, Escape to cancel.
- **Collapsible nodes** — opt-in per split or stack via `collapsible: true`. `rails.toggleCollapsed(nodeId)` flips `collapsed`. A collapsed node renders as a 32px strip along its parent's axis with a restore button; consumers can decorate further via `.rails-collapsed`.
- **Tab badges** — `badge?: string | number` on a tab renders as a pill after the title (styled by default theme). Updated via `updateTab(id, { badge })`.
- Drop zones: reorder, edge split, workspace-rim split, gap, append, new float, float titlebar
- Resize bars at every level, with flex preservation
- Panel cache with `onPanelDestroy` cleanup hook (fires for any reactive-framework teardown)
- `renderEmpty()` for the empty workspace state
- `batch(fn)` for bulk mutations
- `updateTab(id, patch)` with chrome-vs-payload classification
- `Escape` cancels any drag (tab, splitter, float drag, float resize)
- Activate-in-place and float-raise-in-place — no chrome rebuild on click
- Per-tab `closeable` / `draggable` flags
- `canCloseTab` / `canMoveTab` / `canCreateFloat` / `canDropOn` hooks
- Serialize / deserialize
- Event subscription (`on`/`off` + shortcut handlers): `tab:move/close/activate/contextmenu`, `float:create/close/move/resize/minimize/maximize/raise`, `node:collapse/expand`, `layout:change`, `strip:contextmenu`, `float:titlebar:contextmenu`
- ARIA (tablist/tab/tabpanel/dialog) + keyboard nav (arrow keys in strip, Ctrl-Tab/Ctrl-Shift-Tab cycle, Ctrl-W close)
- Touch support: touch-action on interactive elements, setPointerCapture, enlarged drop zones
- Optional theme (`rails-default.css`) — GCU aesthetic, CSS custom properties for overrides

## Docs

- [`SPEC.md`](./SPEC.md) — full design document
- [`INTEGRATION.md`](./INTEGRATION.md) — integration patterns, common migrations, real pitfalls

## License

MIT.
