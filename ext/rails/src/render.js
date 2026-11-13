// @gcu/rails — chrome rendering + content positioning + panel cache
// DOM-touching. Expects an instance object holding host/chromeLayer/contentLayer/state/panels/callbacks.

import { liveTabIds, isSplit, dockStacks, findStack } from './state.js';

export function cssEscape(s) {
  return (typeof window !== 'undefined' && window.CSS && window.CSS.escape)
    ? window.CSS.escape(s)
    : String(s).replace(/["\\]/g, '\\$&');
}

// z-index scheme. Docked panels sit at RAIL_PANEL_Z, above the resize bars
// (z:2) but below the lowest float. Each float gets a 10-unit z-band:
//   chrome  (titlebar/strip/slot)        : base + z*10 + 0
//   panel   (the rendered tab body)      : base + z*10 + 5
//   handles (resize handles overlay)     : base + z*10 + 6
// The handles overlay is a sibling of the float (not a child), so it lives
// outside the float's stacking context and can paint above the panel — which
// otherwise would cover the bottom and side handles wherever the slot extends
// to the float's edges. The next float's chrome starts at +10 above this one,
// so float windows still stack as discrete units.
const RAIL_PANEL_Z = 5;
const FLOAT_Z_BASE = 100;
const FLOAT_Z_STEP = 10;
const FLOAT_PANEL_OFFSET = 5;
const FLOAT_HANDLES_OFFSET = 6;

export function floatChromeZ(z) {
  return FLOAT_Z_BASE + z * FLOAT_Z_STEP;
}

export function floatPanelZ(z) {
  return FLOAT_Z_BASE + z * FLOAT_Z_STEP + FLOAT_PANEL_OFFSET;
}

export function floatHandlesZ(z) {
  return FLOAT_Z_BASE + z * FLOAT_Z_STEP + FLOAT_HANDLES_OFFSET;
}

// Chrome sublayer structure (built once in api.js's createRails init):
//
//   .rails-chrome
//     .rails-rails     — the docked tree, rebuilt on structural changes
//     .rails-floats    — float frames, rebuilt on structural float changes
//
// renderChrome wipes + rebuilds both sublayers from state. Float raise and
// stack activate are in-place and do NOT rebuild (see activateInPlace,
// raiseFloatInPlace in api.js / drag.js).

export function ensureSublayers(inst) {
  if (!inst.railsLayer) {
    inst.railsLayer = document.createElement('div');
    inst.railsLayer.className = 'rails-rails';
    inst.chromeLayer.appendChild(inst.railsLayer);
  }
  if (!inst.floatsLayer) {
    inst.floatsLayer = document.createElement('div');
    inst.floatsLayer.className = 'rails-floats';
    inst.chromeLayer.appendChild(inst.floatsLayer);
  }
}

export function renderChrome(inst) {
  ensureSublayers(inst);
  inst.railsLayer.innerHTML = '';
  inst.floatsLayer.innerHTML = '';
  inst._emptyEl = null;

  // Empty workspace: mount renderEmpty() if provided.
  if (!inst.state.root && (!inst.state.floats || inst.state.floats.length === 0)) {
    if (inst.callbacks.renderEmpty) {
      const el = inst.callbacks.renderEmpty();
      if (el) {
        el.classList.add('rails-empty');
        inst.railsLayer.appendChild(el);
        inst._emptyEl = el;
      }
    }
    reposition(inst);
    inst._emit('layout:change', { state: inst.state });
    return;
  }

  renderDock(inst);
  renderFloats(inst);
  reposition(inst);
  inst._emit('layout:change', { state: inst.state });
}

// Collapse / expand button for a collapsible node. The glyph points along
// the parent's axis: a node in a row folds sideways, one in a column folds up.
function buildCollapseBtn(inst, node, kind, parentDir) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = kind === 'expand' ? 'rails-expand-btn' : 'rails-collapse-btn';
  const row = parentDir !== 'col';
  btn.textContent = kind === 'expand' ? (row ? '▶' : '▼') : (row ? '◀' : '▲');
  const label = kind === 'expand' ? 'Expand' : 'Collapse';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.tabIndex = -1;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    inst._toggleCollapsed(node.id);
  });
  return btn;
}

function renderDock(inst) {
  const root = inst.state.root;
  if (!root) return;
  const el = renderNode(inst, root, null);
  el.style.flex = '1 1 auto';
  inst.railsLayer.appendChild(el);
}

// Build the element for one docked node (recursively for splits). The
// caller's flex container lays it out; sizing comes from flex / size.
function renderNode(inst, node, parent) {
  const parentDir = parent ? parent.dir : null;
  let el;
  if (node.collapsed && parent) {
    // Collapsed: a fixed 32px strip with a restore button. Nothing inside
    // renders; the panels of its stacks are hidden by reposition (no slot).
    el = document.createElement('div');
    el.className = 'rails-node rails-collapsed ' + (parentDir === 'col' ? 'rails-collapsed-col' : 'rails-collapsed-row');
    el.dataset.nodeId = node.id;
    el.style.flex = '0 0 32px';
    el.appendChild(buildCollapseBtn(inst, node, 'expand', parentDir));
    return el;
  }

  if (isSplit(node)) {
    el = document.createElement('div');
    el.className = 'rails-node rails-split ' + (node.dir === 'col' ? 'rails-col' : 'rails-row');
    el.dataset.nodeId = node.id;
    node.children.forEach((child, i) => {
      el.appendChild(renderNode(inst, child, node));
      if (i < node.children.length - 1) {
        const bar = document.createElement('div');
        bar.className = 'rails-bar ' + (node.dir === 'col' ? 'rails-bar-col' : 'rails-bar-row');
        bar.addEventListener('pointerdown', e => inst._onSplitterDown(e, node, i));
        el.appendChild(bar);
      }
    });
  } else {
    el = buildStackEl(inst, node);
    el.classList.add('rails-node');
    el.dataset.nodeId = node.id;
  }

  if (parent) {
    el.style.flex = node.size != null ? `0 0 ${node.size}px` : String(node.flex ?? 1);
  }

  // A collapsible node puts its collapse button into its first strip-wrap,
  // as a flex sibling of the tabs/overflow button rather than floating over
  // them.
  if (node.collapsible && parent) {
    const firstWrap = el.querySelector('.rails-strip-wrap');
    if (firstWrap) firstWrap.appendChild(buildCollapseBtn(inst, node, 'collapse', parentDir));
  }
  return el;
}

// Build a fully-assembled .rails-stack element (no size styling applied yet;
// caller handles sizing). Used for docked stacks and float-stacks.
function buildStackEl(inst, stack) {
  const stackEl = document.createElement('div');
  stackEl.className = 'rails-stack';
  const tabPos = stack.tabPosition || inst.config.tabPosition || 'top';
  if (tabPos === 'bottom') stackEl.classList.add('rails-tabs-bottom');
  stackEl.dataset.stackId = stack.id;

  const stripWrap = buildStripWrap(inst, stack);
  const slot = document.createElement('div');
  slot.className = 'rails-slot';
  slot.dataset.slotFor = stack.id;
  // ARIA: slot holds the active panel via its cached element.
  slot.setAttribute('role', 'tabpanel');
  slot.id = `rails-panel-${stack.id}`;

  if (tabPos === 'bottom') {
    stackEl.append(slot, stripWrap);
  } else {
    stackEl.append(stripWrap, slot);
  }
  return stackEl;
}

// Strip wrapper — flex row holding the scrollable strip + overflow button.
// The button lives next to (not inside) the scrollable strip so it doesn't
// scroll away with the tabs.
function buildStripWrap(inst, stack) {
  const wrap = document.createElement('div');
  wrap.className = 'rails-strip-wrap';
  const strip = buildStrip(inst, stack);
  const overflowBtn = buildOverflowBtn(inst, stack, strip);
  wrap.append(strip, overflowBtn);
  // Opt-in new-tab button (config.newTabButton). Lives in the strip wrap next
  // to the overflow button so it never scrolls away with the tabs. Emits
  // `strip:newtab` ({ stack }) — the host spawns into that specific stack.
  if (inst.config.newTabButton) wrap.append(buildNewTabBtn(inst, stack));
  return wrap;
}

function buildNewTabBtn(inst, stack) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rails-newtab-btn';
  btn.textContent = '+'; // +
  btn.setAttribute('aria-label', 'New tab');
  btn.title = 'New tab';
  btn.tabIndex = -1;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    inst._emit('strip:newtab', { stack });
  });
  return btn;
}

function buildOverflowBtn(inst, stack, strip) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rails-overflow-btn';
  btn.textContent = '\u22ef'; // ⋯
  btn.setAttribute('aria-label', 'Overflow tabs');
  btn.title = 'Overflow tabs';
  btn.tabIndex = -1;
  btn.hidden = true;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const overflowTabs = computeOverflowTabs(strip, stack);
    const r = btn.getBoundingClientRect();
    inst._emit('strip:overflow', {
      stack, overflowTabs,
      x: r.right, y: r.bottom,
    });
  });
  // Observe the strip for size/content changes; toggle btn visibility.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => updateOverflowBtn(btn, strip));
    ro.observe(strip);
  }
  // Initial compute in a microtask so layout has run.
  Promise.resolve().then(() => updateOverflowBtn(btn, strip));
  return btn;
}

function updateOverflowBtn(btn, strip) {
  if (!btn.isConnected) return;
  const overflow = strip.scrollWidth > strip.clientWidth + 1;
  btn.hidden = !overflow;
}

function computeOverflowTabs(strip, stack) {
  // Tabs whose rendered edges fall outside the strip's visible viewport.
  const tabEls = strip.querySelectorAll(':scope > .rails-tab');
  const sr = strip.getBoundingClientRect();
  const out = [];
  tabEls.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.right > sr.right + 1 || r.left < sr.left - 1) {
      const tab = stack.tabs.find(t => t.id === el.dataset.tabId);
      if (tab) out.push(tab);
    }
  });
  return out;
}

function buildStrip(inst, stack) {
  const strip = document.createElement('div');
  strip.className = 'rails-strip';
  strip.dataset.stackId = stack.id;
  strip.setAttribute('role', 'tablist');
  strip.tabIndex = 0;

  strip.addEventListener('contextmenu', e => {
    if (e.target === strip) {
      e.preventDefault();
      inst._emit('strip:contextmenu', { stack, x: e.clientX, y: e.clientY });
    }
  });
  strip.addEventListener('keydown', e => inst._onStripKeyDown(e, stack));

  stack.tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = 'rails-tab';
    if (tab.id === stack.active) tabEl.classList.add('rails-active');
    if (tab.closeable === false) tabEl.classList.add('rails-pinned-closed');
    if (tab.draggable === false) tabEl.classList.add('rails-locked');
    tabEl.dataset.tabId = tab.id;

    // ARIA
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', tab.id === stack.active ? 'true' : 'false');
    tabEl.setAttribute('aria-controls', `rails-panel-${stack.id}`);
    tabEl.id = `rails-tab-${tab.id}`;
    tabEl.tabIndex = tab.id === stack.active ? 0 : -1;

    const label = document.createElement('span');
    label.className = 'rails-tab-label';
    label.textContent = tab.title ?? tab.id;
    tabEl.appendChild(label);

    if (tab.badge != null && tab.badge !== '') {
      const badge = document.createElement('span');
      badge.className = 'rails-tab-badge';
      badge.textContent = String(tab.badge);
      tabEl.appendChild(badge);
    }

    if (tab.closeable !== false) {
      const x = document.createElement('span');
      x.className = 'rails-x';
      x.textContent = '\u00d7';
      x.dataset.closeTab = tab.id;
      x.setAttribute('aria-label', `Close ${tab.title ?? tab.id}`);
      x.setAttribute('role', 'button');
      tabEl.appendChild(x);
    }

    tabEl.addEventListener('pointerdown', e => inst._onTabDown(e, tab.id));
    tabEl.addEventListener('contextmenu', e => {
      e.preventDefault();
      inst._emit('tab:contextmenu', { tab, stack, x: e.clientX, y: e.clientY });
    });

    strip.appendChild(tabEl);
  });
  return strip;
}

function renderFloats(inst) {
  if (!Array.isArray(inst.state.floats)) return;
  // Render in z-order so the DOM order is irrelevant for painting
  // (we use style.zIndex directly), but DOM order still matches z for dev tools.
  const sorted = [...inst.state.floats].sort((a, b) => a.z - b.z);
  for (const float of sorted) {
    inst.floatsLayer.appendChild(buildFloatEl(inst, float));
    inst.floatsLayer.appendChild(buildFloatHandlesEl(inst, float));
  }
}

function buildFloatEl(inst, float) {
  const el = document.createElement('div');
  el.className = 'rails-float';
  if (float.minimized) el.classList.add('rails-minimized');
  if (float.maximized) el.classList.add('rails-maximized');
  // Auto-hide the in-stack tab strip when the float holds exactly one tab.
  // The titlebar already shows that tab's title, so the strip would just be
  // a redundant single-pill row. CSS keys off this class.
  if ((float.stack?.tabs?.length ?? 0) <= 1) el.classList.add('rails-float-single-tab');
  el.dataset.floatId = float.id;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', float.stack?.tabs.find(t => t.id === float.stack.active)?.title ?? 'Floating panel');
  el.style.left = float.x + 'px';
  el.style.top = float.y + 'px';
  el.style.width = float.w + 'px';
  el.style.height = float.h + 'px';
  el.style.zIndex = floatChromeZ(float.z);

  // Titlebar (drag handle + buttons)
  const titlebar = document.createElement('div');
  titlebar.className = 'rails-titlebar';
  titlebar.dataset.floatId = float.id;

  const titleLabel = document.createElement('div');
  titleLabel.className = 'rails-titlebar-label';
  const activeTab = float.stack?.tabs.find(t => t.id === float.stack.active);
  titleLabel.textContent = activeTab?.title ?? '';
  titlebar.appendChild(titleLabel);

  const btns = document.createElement('div');
  btns.className = 'rails-titlebar-buttons';
  btns.appendChild(makeTitleButton('rails-btn-minimize', '\u2013', 'Minimize'));
  btns.appendChild(makeTitleButton('rails-btn-maximize', float.maximized ? '\u29c9' : '\u25a1', float.maximized ? 'Restore' : 'Maximize'));
  btns.appendChild(makeTitleButton('rails-btn-close', '\u00d7', 'Close'));
  titlebar.appendChild(btns);

  titlebar.addEventListener('pointerdown', e => inst._onFloatTitlebarDown(e, float.id));
  titlebar.addEventListener('contextmenu', e => {
    e.preventDefault();
    inst._emit('float:titlebar:contextmenu', { float, x: e.clientX, y: e.clientY });
  });

  // Click on title buttons (delegated)
  btns.addEventListener('click', e => {
    const btn = e.target.closest('.rails-btn-minimize, .rails-btn-maximize, .rails-btn-close');
    if (!btn) return;
    e.stopPropagation();
    if (btn.classList.contains('rails-btn-minimize')) inst._toggleFloatMinimized(float.id);
    else if (btn.classList.contains('rails-btn-maximize')) inst._toggleFloatMaximized(float.id);
    else if (btn.classList.contains('rails-btn-close')) inst._closeFloat(float.id);
  });

  el.appendChild(titlebar);

  // Stack (strip + slot). Floats always render top-tabs.
  if (float.stack) {
    const stackEl = buildStackEl(inst, float.stack);
    // Float stacks fill remaining space below titlebar.
    stackEl.classList.add('rails-stack-in-float');
    el.appendChild(stackEl);
  }

  // Raise-on-pointerdown anywhere in the float.
  el.addEventListener('pointerdown', e => {
    // Only raise if the float isn't already topmost.
    const topZ = Math.max(0, ...inst.state.floats.map(f => f.z));
    if (float.z < topZ) inst._raiseFloat(float.id);
  }, true);

  return el;
}

// Per-float handles overlay — sibling of the float in floatsLayer, at z above
// the panel. Pointer-transparent; only the 8 handles re-enable pointer events.
// The overlay's bounds and z-index are kept synced to the float by
// setFloatBoundsInPlace and raiseFloatInPlace.
function buildFloatHandlesEl(inst, float) {
  const overlay = document.createElement('div');
  overlay.className = 'rails-float-handles';
  if (float.minimized) overlay.classList.add('rails-minimized');
  if (float.maximized) overlay.classList.add('rails-maximized');
  overlay.dataset.handlesFor = float.id;
  overlay.style.left = float.x + 'px';
  overlay.style.top = float.y + 'px';
  overlay.style.width = float.w + 'px';
  overlay.style.height = float.h + 'px';
  overlay.style.zIndex = floatHandlesZ(float.z);

  for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const handle = document.createElement('div');
    handle.className = `rails-resize-handle rails-resize-handle-${dir}`;
    handle.dataset.resize = dir;
    handle.addEventListener('pointerdown', e => inst._onFloatResizeDown(e, float.id, dir));
    overlay.appendChild(handle);
  }

  // No raise-on-pointerdown listener here: onFloatResizeDown already raises
  // the float at resize start, and the overlay itself is pointer-transparent
  // (pointer-events: none) so non-handle clicks fall through to the panel.

  return overlay;
}

function makeTitleButton(cls, glyph, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = glyph;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.tabIndex = -1;
  return b;
}

// Rebuild a single stack's strip wrapper in place (used by updateTab).
// Rebuilds the whole strip-wrap (strip + overflow button) so the RO and
// click-handler closures reference the new strip element.
export function rebuildStrip(inst, stackId) {
  const oldStrip = inst.chromeLayer.querySelector(
    `.rails-strip[data-stack-id="${cssEscape(stackId)}"]`
  );
  if (!oldStrip) {
    renderChrome(inst);
    return;
  }
  const stack = findStack(inst.state, stackId)?.stack;
  if (!stack) {
    renderChrome(inst);
    return;
  }
  const oldWrap = oldStrip.parentElement;
  if (!oldWrap || !oldWrap.classList.contains('rails-strip-wrap')) {
    renderChrome(inst);
    return;
  }
  const newWrap = buildStripWrap(inst, stack);
  oldWrap.replaceWith(newWrap);
  reposition(inst);
  inst._emit('layout:change', { state: inst.state });
}


// Position panels for all stacks (dock + floats). Show the active tab per
// stack; hide all others. Assigns per-panel z-index:
//   - docked tabs → 5 (above the resize bars at z:2, below the floats
//     layer at z:100)
//   - float tabs → 100 + float.z (same effective root z as the float's own
//     chrome; DOM order breaks the tie and the panel wins because contentLayer
//     comes after chromeLayer in DOM. This is what lets the topmost float's
//     panel paint above every other float's chrome when you raise it.)
export function reposition(inst) {
  const wsRect = inst.host.getBoundingClientRect();
  const activeIds = new Set();

  const placeFromStack = (stack, float) => {
    const slot = inst.chromeLayer.querySelector(
      `.rails-slot[data-slot-for="${cssEscape(stack.id)}"]`
    );
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    const activeTab = stack.tabs.find(t => t.id === stack.active);
    if (!activeTab) return;
    const panel = getPanel(inst, activeTab);
    panel.style.left = (r.left - wsRect.left) + 'px';
    panel.style.top = (r.top - wsRect.top) + 'px';
    panel.style.width = r.width + 'px';
    panel.style.height = r.height + 'px';
    panel.style.display = '';
    panel.style.zIndex = float ? String(floatPanelZ(float.z ?? 0)) : String(RAIL_PANEL_Z);
    activeIds.add(activeTab.id);
  };

  for (const stack of dockStacks(inst.state)) placeFromStack(stack, null);
  for (const float of inst.state.floats || []) {
    if (float.minimized) continue; // panel hidden when float is minimized
    if (float.stack) placeFromStack(float.stack, float);
  }

  for (const [tabId, el] of inst.panels) {
    if (!activeIds.has(tabId)) el.style.display = 'none';
  }
}

export function getPanel(inst, tab) {
  let panel = inst.panels.get(tab.id);
  if (panel) return panel;
  const wrap = document.createElement('div');
  wrap.className = 'rails-panel';
  wrap.dataset.tabId = tab.id;
  const body = inst.callbacks.renderPanel(tab);
  if (body) wrap.appendChild(body);
  inst.contentLayer.appendChild(wrap);
  inst.panels.set(tab.id, wrap);
  return wrap;
}

export function destroyPanel(inst, tabId, tab) {
  const el = inst.panels.get(tabId);
  if (!el) return;
  try {
    if (inst.callbacks.onPanelDestroy) {
      inst.callbacks.onPanelDestroy(tab || { id: tabId }, el);
    }
  } catch (err) {
    console.error('rails: onPanelDestroy threw', err);
  }
  el.remove();
  inst.panels.delete(tabId);
}

export function reconcilePanels(inst) {
  const live = liveTabIds(inst.state);
  for (const [tabId] of inst.panels) {
    if (!live.has(tabId)) destroyPanel(inst, tabId, null);
  }
}

export function destroyAllPanels(inst) {
  for (const [tabId] of inst.panels) destroyPanel(inst, tabId, null);
}

// In-place activate: swap .rails-active class on the strip, then reposition.
export function activateInPlace(inst, stack, tabId) {
  if (stack.active === tabId) return;
  stack.active = tabId;
  const strip = inst.chromeLayer.querySelector(
    `.rails-strip[data-stack-id="${cssEscape(stack.id)}"]`
  );
  if (strip) {
    for (const tabEl of strip.querySelectorAll('.rails-tab')) {
      const match = tabEl.dataset.tabId === tabId;
      tabEl.classList.toggle('rails-active', match);
      tabEl.setAttribute('aria-selected', match ? 'true' : 'false');
      tabEl.tabIndex = match ? 0 : -1;
    }
  }
  reposition(inst);
  const tab = stack.tabs.find(t => t.id === tabId);
  if (tab) inst._emit('tab:activate', { tab, stack });
}

// In-place raise of a float: update zIndex on the float element + handles
// overlay, then re-run reposition so the float's panel z-index is current.
// Without the reposition, a freshly-raised float's panel still has its old
// z-index and a previously-topmost float's panel keeps painting above it.
export function raiseFloatInPlace(inst, floatId) {
  const float = inst.state.floats.find(f => f.id === floatId);
  if (!float) return;
  const maxZ = Math.max(0, ...inst.state.floats.map(f => f.z));
  if (float.z >= maxZ) return;
  float.z = maxZ + 1;
  const el = inst.chromeLayer.querySelector(`.rails-float[data-float-id="${cssEscape(floatId)}"]`);
  if (el) el.style.zIndex = floatChromeZ(float.z);
  const handlesEl = inst.chromeLayer.querySelector(
    `.rails-float-handles[data-handles-for="${cssEscape(floatId)}"]`
  );
  if (handlesEl) handlesEl.style.zIndex = floatHandlesZ(float.z);
  reposition(inst);
  inst._emit('float:raise', { float });
}

// In-place bounds update (drag / resize). No chrome rebuild. Updates both
// the float root element and its handles overlay sibling.
export function setFloatBoundsInPlace(inst, floatId, bounds) {
  const float = inst.state.floats.find(f => f.id === floatId);
  if (!float) return;
  if ('x' in bounds) float.x = bounds.x;
  if ('y' in bounds) float.y = bounds.y;
  if ('w' in bounds) float.w = bounds.w;
  if ('h' in bounds) float.h = bounds.h;
  const el = inst.chromeLayer.querySelector(`.rails-float[data-float-id="${cssEscape(floatId)}"]`);
  if (el) {
    el.style.left = float.x + 'px';
    el.style.top = float.y + 'px';
    el.style.width = float.w + 'px';
    el.style.height = float.h + 'px';
  }
  const handlesEl = inst.chromeLayer.querySelector(
    `.rails-float-handles[data-handles-for="${cssEscape(floatId)}"]`
  );
  if (handlesEl) {
    handlesEl.style.left = float.x + 'px';
    handlesEl.style.top = float.y + 'px';
    handlesEl.style.width = float.w + 'px';
    handlesEl.style.height = float.h + 'px';
  }
  reposition(inst);
}
