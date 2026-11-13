// @gcu/rails — tab drag, splitter drag, float drag/resize, drop zones, Escape-cancel
// All drag state lives on the instance (inst.drag); no module-scoped mutables.

import { findTab, findFloat, findStack, isSplit, placeStack } from './state.js';
import { cssEscape, setFloatBoundsInPlace, raiseFloatInPlace, activateInPlace } from './render.js';

const HOVER_ACTIVATE_DELAY_MS = 500;
const STRIP_EDGE_SCROLL_PX = 40;
const STRIP_EDGE_SCROLL_SPEED = 8; // px per frame

// ── splitter drag ─────────────────────────────────────────────────────────

const MIN_ROW_CHILD = 140;   // px — a child of a row split (width)
const MIN_COL_CHILD = 100;   // px — a child of a column split (height)

// Drag the bar between split.children[idx] and [idx + 1]. Adjusts the two
// adjacent weights, preserving their sum, so other siblings don't move.
export function onSplitterDown(inst, e, split, idx) {
  e.preventDefault();
  e.stopPropagation();

  const a = split.children[idx], b = split.children[idx + 1];
  if (!a || !b) return;
  const snapshot = [{ target: a, flex: a.flex }, { target: b, flex: b.flex }];
  const row = split.dir !== 'col';
  const min = row ? MIN_ROW_CHILD : MIN_COL_CHILD;
  const nodeEl = n => inst.railsLayer.querySelector(`[data-node-id="${cssEscape(n.id)}"]`);

  for (const p of inst.panels.values()) p.classList.add('rails-dragging');

  const scrim = document.createElement('div');
  scrim.className = 'rails-scrim';
  scrim.style.cursor = row ? 'col-resize' : 'row-resize';
  inst.host.appendChild(scrim);

  const onMove = ev => {
    const ae = nodeEl(a), be = nodeEl(b);
    if (!ae || !be) return;
    const ra = ae.getBoundingClientRect(), rb = be.getBoundingClientRect();
    const total = row ? ra.width + rb.width : ra.height + rb.height;
    const totalFlex = (a.flex ?? 1) + (b.flex ?? 1);
    const pos = row ? ev.clientX - ra.left : ev.clientY - ra.top;
    const lo = Math.min(min, total / 2);
    const v = Math.max(lo, Math.min(total - lo, pos));
    a.flex = (v / total) * totalFlex;
    b.flex = totalFlex - a.flex;
    ae.style.flex = a.flex;
    be.style.flex = b.flex;
    inst._reposition();
  };

  const cleanup = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    for (const p of inst.panels.values()) p.classList.remove('rails-dragging');
    inst.drag = null;
  };

  const onUp = () => {
    cleanup();
    inst._emit('layout:change', { state: inst.state });
  };

  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    for (const snap of snapshot) snap.target.flex = snap.flex;
    cleanup();
    inst._renderChrome();
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', onKey);

  inst.drag = { kind: 'splitter' };
}

// ── tab drag ──────────────────────────────────────────────────────────────

export function onTabDown(inst, e, tabId) {
  if (e.target.dataset.closeTab) return;
  if (e.button !== 0) return;
  e.preventDefault();

  const hit = findTab(inst.state, tabId);
  if (!hit) return;
  if (hit.tab.draggable === false) {
    const onUp = () => {
      document.removeEventListener('pointerup', onUp);
      inst._activate(hit.stack, tabId);
    };
    document.addEventListener('pointerup', onUp);
    return;
  }

  // Capture the pointer on the tab element so the move/up fire there even
  // if the finger leaves it (esp. touch).
  try { e.target.setPointerCapture?.(e.pointerId); } catch {}

  const pointerType = e.pointerType;
  const startX = e.clientX, startY = e.clientY;
  const threshold = inst.config.dragThreshold ?? 4;
  let started = false;

  const onMove = ev => {
    if (!started) {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < threshold) return;
      started = true;
      beginTabDrag(inst, hit.tab, pointerType);
    }
    updateTabDrag(inst, ev);
  };

  const onUp = ev => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
    if (started) {
      endTabDrag(inst, ev);
    } else {
      const h = findTab(inst.state, tabId);
      if (h) inst._activate(h.stack, tabId);
    }
  };

  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    if (started) cancelTabDrag(inst);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', onKey);
}

// ── float titlebar drag (either moves float, or redocks into the dock) ───────

export function onFloatTitlebarDown(inst, e, floatId) {
  // Ignore clicks on titlebar buttons.
  if (e.target.closest('.rails-titlebar-buttons')) return;
  if (e.button !== 0) return;
  e.preventDefault();

  const float = findFloat(inst.state, floatId);
  if (!float) return;
  if (float.maximized) return; // can't drag a maximized float

  // Raise on pointerdown.
  raiseFloatInPlace(inst, floatId);

  const startX = e.clientX, startY = e.clientY;
  const origX = float.x, origY = float.y, origW = float.w, origH = float.h;
  const grabOffset = { dx: e.clientX - float.x, dy: e.clientY - float.y };
  const threshold = inst.config.dragThreshold ?? 4;
  let started = false;
  let dragMode = null; // 'move' | 'redock'

  const onMove = ev => {
    if (!started) {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < threshold) return;
      started = true;
      // Begin as a move. If the cursor enters a docked drop zone during the drag,
      // we'll transition into 'redock' mode (showing zones, allowing drop).
      dragMode = 'move';
      beginFloatDrag(inst, float, origX, origY, origW, origH);
    }
    updateFloatDrag(inst, ev, float, grabOffset);
  };

  const onUp = ev => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
    if (started) endFloatDrag(inst, ev, float);
    // else: click on titlebar with no drag; the raise above already fired.
  };

  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    if (started) {
      // Restore pre-drag bounds.
      setFloatBoundsInPlace(inst, floatId, { x: origX, y: origY, w: origW, h: origH });
      teardownFloatDrag(inst);
    }
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', onKey);
}

function beginFloatDrag(inst, float, origX, origY, origW, origH) {
  for (const p of inst.panels.values()) p.classList.add('rails-dragging');

  const scrim = document.createElement('div');
  scrim.className = 'rails-scrim';
  inst.host.appendChild(scrim);

  // Compute docked drop zones (not new-float — the float itself is being dragged)
  // so the user can redock by dropping on any docked zone. Exclude the
  // dragging float's own titlebar from the zone set — dropping a float on itself
  // is a no-op.
  const activeTab = float.stack?.tabs.find(t => t.id === float.stack.active);
  const zones = activeTab ? computeRedockZones(inst, activeTab, float.id) : [];
  const zoneEls = zones.map(z => makeZoneEl(inst, z));

  inst.drag = {
    kind: 'float',
    float,
    origBounds: { x: origX, y: origY, w: origW, h: origH },
    scrim,
    zones,
    zoneEls,
    active: null,
  };
}

function updateFloatDrag(inst, ev, float, grabOffset) {
  const drag = inst.drag;
  if (!drag || drag.kind !== 'float') return;
  // Move float by pointer.
  const newX = ev.clientX - grabOffset.dx;
  const newY = ev.clientY - grabOffset.dy;
  setFloatBoundsInPlace(inst, float.id, { x: newX, y: newY });

  // Hit-test redock zones.
  const wsRect = inst.host.getBoundingClientRect();
  const lx = ev.clientX - wsRect.left;
  const ly = ev.clientY - wsRect.top;
  let best = null, bestScore = Infinity;
  for (const z of drag.zones) {
    const r = z.hit || z.rect;   // tab-insert hit is wider than its caret visual
    if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) {
      const area = r.w * r.h;
      const score = z.priority === 'body-append' ? area + 1e9 : area;
      if (score < bestScore) { best = z; bestScore = score; }
    }
  }
  drag.zoneEls.forEach((el, i) => el.classList.toggle('rails-active', drag.zones[i] === best));
  drag.active = best;
}

function endFloatDrag(inst, ev, float) {
  const drag = inst.drag;
  if (!drag || drag.kind !== 'float') return;
  const { active } = drag;
  teardownFloatDrag(inst);

  if (!active) {
    // Plain move; emit event.
    inst._emit('float:move', {
      float,
      from: drag.origBounds,
      to: { x: float.x, y: float.y, w: float.w, h: float.h }
    });
    inst.drag = null;
    return;
  }

  // Redock: destroy float, move each of its tabs to the target stack.
  // We preserve tab order; the active tab in the float stays active post-redock.
  const tabs = [...float.stack.tabs];
  const activeId = float.stack.active;
  const toDesc = zoneToMoveTarget(active);

  // Remove the float first.
  inst.state.floats = inst.state.floats.filter(f => f.id !== float.id);

  // For multi-tab redock, create the target stack once (if needed) then
  // append all tabs into it. For stack/append-type targets, just append.
  const destStack = resolveRedockDestination(inst, active);
  if (destStack) {
    for (const tab of tabs) destStack.tabs.push(tab);
    destStack.active = activeId;
  }

  inst.drag = null;
  inst._cleanupAndRender();
  inst._emit('float:close', { float });
  inst._emit('tab:move', {
    tab: tabs[0],
    from: { floatId: float.id },
    to: toDesc
  });
}

// Resolve (or create) the target stack for redocking a float's tabs in bulk.
// For gap / edge targets, creates the stack. For stack/insert targets,
// returns the existing stack.
function resolveRedockDestination(inst, zone) {
  if (isNewStackZone(zone)) {
    const ns = { id: inst._freshId('s'), tabs: [], active: null };
    placeStack(inst.state, zoneToMoveTarget(zone), ns);
    return ns;
  }
  if (zone.type === 'tab-insert' || zone.type === 'tab-append') {
    return findStack(inst.state, zone.stackId)?.stack || null;
  }
  if (zone.type === 'float-titlebar') {
    const f = findFloat(inst.state, zone.floatId);
    return f?.stack || null;
  }
  return null;
}

function isNewStackZone(zone) {
  return zone.type === 'gap' || zone.type === 'edge' || zone.type === 'workspace-edge';
}

function teardownFloatDrag(inst) {
  const drag = inst.drag;
  if (!drag || drag.kind !== 'float') return;
  drag.scrim?.remove();
  drag.zoneEls?.forEach(el => el.remove());
  for (const p of inst.panels.values()) p.classList.remove('rails-dragging');
}

// ── float resize (8 handles) ──────────────────────────────────────────────

export function onFloatResizeDown(inst, e, floatId, dir) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const float = findFloat(inst.state, floatId);
  if (!float || float.maximized || float.minimized) return;

  const startX = e.clientX, startY = e.clientY;
  const origX = float.x, origY = float.y, origW = float.w, origH = float.h;
  const minW = inst.config.minFloatSize?.w ?? 200;
  const minH = inst.config.minFloatSize?.h ?? 120;

  raiseFloatInPlace(inst, floatId);

  for (const p of inst.panels.values()) p.classList.add('rails-dragging');
  const scrim = document.createElement('div');
  scrim.className = 'rails-scrim';
  inst.host.appendChild(scrim);

  inst.drag = { kind: 'float-resize', float, origBounds: { x: origX, y: origY, w: origW, h: origH }, scrim };

  const onMove = ev => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    let nx = origX, ny = origY, nw = origW, nh = origH;
    if (dir.includes('e')) nw = Math.max(minW, origW + dx);
    if (dir.includes('s')) nh = Math.max(minH, origH + dy);
    if (dir.includes('w')) {
      const newW = Math.max(minW, origW - dx);
      nx = origX + (origW - newW);
      nw = newW;
    }
    if (dir.includes('n')) {
      const newH = Math.max(minH, origH - dy);
      ny = origY + (origH - newH);
      nh = newH;
    }
    setFloatBoundsInPlace(inst, floatId, { x: nx, y: ny, w: nw, h: nh });
  };

  const cleanup = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    for (const p of inst.panels.values()) p.classList.remove('rails-dragging');
    inst.drag = null;
  };

  const onUp = () => {
    const from = { x: origX, y: origY, w: origW, h: origH };
    const to = { x: float.x, y: float.y, w: float.w, h: float.h };
    cleanup();
    inst._emit('float:resize', { float, from, to });
  };

  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    setFloatBoundsInPlace(inst, floatId, { x: origX, y: origY, w: origW, h: origH });
    cleanup();
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', onKey);
}

// ── tab drag internals ────────────────────────────────────────────────────

function beginTabDrag(inst, tab, pointerType) {
  for (const p of inst.panels.values()) p.classList.add('rails-dragging');

  const scrim = document.createElement('div');
  scrim.className = 'rails-scrim';
  inst.host.appendChild(scrim);

  const ghost = document.createElement('div');
  ghost.className = 'rails-ghost';
  const label = document.createElement('span');
  label.textContent = tab.title ?? tab.id;
  ghost.appendChild(label);
  inst.host.appendChild(ghost);

  const zones = computeZones(inst, tab, pointerType === 'touch');
  const zoneEls = zones.map(z => makeZoneEl(inst, z));

  inst.drag = {
    kind: 'tab',
    tab,
    ghost,
    scrim,
    zones,
    zoneEls,
    active: null,
  };
}

function updateTabDrag(inst, ev) {
  const drag = inst.drag;
  if (!drag || drag.kind !== 'tab') return;
  const wsRect = inst.host.getBoundingClientRect();
  const lx = ev.clientX - wsRect.left;
  const ly = ev.clientY - wsRect.top;
  drag.ghost.style.left = (lx + 14) + 'px';
  drag.ghost.style.top = (ly + 14) + 'px';

  let best = null, bestScore = Infinity;
  for (const z of drag.zones) {
    const r = z.hit || z.rect;   // tab-insert hit is wider than its caret visual
    if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) {
      const area = r.w * r.h;
      const score = z.priority === 'body-append' ? area + 1e9
                  : z.priority === 'new-float' ? area + 2e9
                  : area;
      if (score < bestScore) { best = z; bestScore = score; }
    }
  }
  drag.zoneEls.forEach((el, i) => el.classList.toggle('rails-active', drag.zones[i] === best));
  drag.active = best;
  // Stash cursor position for new-float targets (so tear-off places the float
  // at drop point, not at a static rect origin).
  if (best && best.type === 'new-float') {
    best._cursorX = lx - 60;
    best._cursorY = ly - 10;
  }

  maybeHoverActivate(inst, ev);
  maybeEdgeScroll(inst, ev);
}

// Hover-to-activate: if the cursor hovers over an inactive tab for
// HOVER_ACTIVATE_DELAY_MS, activate it. Lets users drop into a stack whose
// active tab is different from the target one.
function maybeHoverActivate(inst, ev) {
  const drag = inst.drag;
  if (!drag) return;
  // scrim covers the workspace — we need to see through it. Temporarily disable.
  if (drag.scrim) drag.scrim.style.pointerEvents = 'none';
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  const tabEl = el?.closest?.('.rails-tab');
  const stripEl = tabEl?.closest?.('.rails-strip');
  const hoverTabId = tabEl?.dataset?.tabId;
  const hoverStackId = stripEl?.dataset?.stackId;

  if (!hoverTabId || !hoverStackId || hoverTabId === drag.tab.id) {
    // Cursor off any hoverable tab, or over the dragged tab itself — cancel.
    if (drag.hoverTimer) {
      clearTimeout(drag.hoverTimer);
      drag.hoverTimer = null;
      drag.hoverTabId = null;
    }
    return;
  }

  // Don't re-arm the timer if we're still over the same tab we already armed for.
  if (drag.hoverTabId === hoverTabId) return;

  if (drag.hoverTimer) clearTimeout(drag.hoverTimer);
  drag.hoverTabId = hoverTabId;
  drag.hoverTimer = setTimeout(() => {
    drag.hoverTimer = null;
    // Re-resolve stack from state (it might have changed since we armed).
    const stackHit = findStack(inst.state, hoverStackId);
    if (!stackHit) return;
    const stack = stackHit.stack;
    if (stack.active === hoverTabId) return; // already active
    activateInPlace(inst, stack, hoverTabId);
    // activateInPlace calls reposition, which may have changed slot rects.
    // Recompute drop zones so they stay correct against the new layout.
    for (const zel of drag.zoneEls) zel.remove();
    drag.zones = computeZones(inst, drag.tab);
    drag.zoneEls = drag.zones.map(z => makeZoneEl(inst, z));
  }, HOVER_ACTIVATE_DELAY_MS);
}

// Scroll an overflowing strip when the drag cursor nears its left or right
// edge. Runs a rAF loop for smooth scroll until the cursor moves away.
function maybeEdgeScroll(inst, ev) {
  const drag = inst.drag;
  if (!drag) return;

  if (drag.scrim) drag.scrim.style.pointerEvents = 'none';
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  const strip = el?.closest?.('.rails-strip');
  if (!strip || strip.scrollWidth <= strip.clientWidth + 1) {
    stopEdgeScroll(drag);
    return;
  }

  const sr = strip.getBoundingClientRect();
  let dir = 0;
  if (ev.clientX < sr.left + STRIP_EDGE_SCROLL_PX) dir = -1;
  else if (ev.clientX > sr.right - STRIP_EDGE_SCROLL_PX) dir = 1;

  if (dir === 0) {
    stopEdgeScroll(drag);
    return;
  }

  if (drag.edgeScroll?.strip === strip && drag.edgeScroll?.dir === dir) return;

  stopEdgeScroll(drag);
  const state = { strip, dir, raf: 0 };
  const tick = () => {
    state.strip.scrollLeft += state.dir * STRIP_EDGE_SCROLL_SPEED;
    // Recompute tab-insert zones against the new scroll position so drops
    // stay accurate.
    for (const zel of drag.zoneEls) zel.remove();
    drag.zones = computeZones(inst, drag.tab);
    drag.zoneEls = drag.zones.map(z => makeZoneEl(inst, z));
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
  drag.edgeScroll = state;
}

function stopEdgeScroll(drag) {
  if (drag?.edgeScroll) {
    cancelAnimationFrame(drag.edgeScroll.raf);
    drag.edgeScroll = null;
  }
}

function endTabDrag(inst, ev) {
  const drag = inst.drag;
  if (!drag || drag.kind !== 'tab') return;
  const { tab, active } = drag;
  teardownTabDrag(inst);

  if (!active) {
    inst.drag = null;
    return;
  }

  const src = findTab(inst.state, tab.id);
  if (!src) { inst.drag = null; return; }

  const fromDesc = src.container === 'float'
    ? { floatId: src.float.id, at: src.idx }
    : { stackId: src.stack.id, at: src.idx };
  const toDesc = zoneToMoveTarget(active);

  if (active.type === 'new-float' && inst.callbacks.canCreateFloat) {
    if (!inst.callbacks.canCreateFloat(tab, { x: active.rect.x, y: active.rect.y })) {
      inst.drag = null;
      return;
    }
  }

  if (inst.callbacks.canMoveTab && !inst.callbacks.canMoveTab(tab, fromDesc, toDesc)) {
    inst.drag = null;
    return;
  }

  // Remove from source.
  src.stack.tabs.splice(src.idx, 1);
  if (src.stack.active === tab.id && src.stack.tabs.length) {
    src.stack.active = src.stack.tabs[Math.max(0, src.idx - 1)].id;
  }

  // Apply target.
  applyMoveTarget(inst, tab, active, src.stack);
  inst.drag = null;

  inst._cleanupAndRender();

  // If we tore off into a new float, emit float:create.
  if (active.type === 'new-float') {
    const newFloat = inst.state.floats[inst.state.floats.length - 1];
    if (newFloat) inst._emit('float:create', { float: newFloat, tab });
  }
  inst._emit('tab:move', { tab, from: fromDesc, to: toDesc });
}

function cancelTabDrag(inst) {
  teardownTabDrag(inst);
  inst.drag = null;
}

function teardownTabDrag(inst) {
  const drag = inst.drag;
  if (!drag || drag.kind !== 'tab') return;
  if (drag.hoverTimer) clearTimeout(drag.hoverTimer);
  stopEdgeScroll(drag);
  drag.ghost?.remove();
  drag.scrim?.remove();
  drag.zoneEls?.forEach(el => el.remove());
  for (const p of inst.panels.values()) p.classList.remove('rails-dragging');
}

// ── drop zone computation ─────────────────────────────────────────────────

function makeZoneEl(inst, z) {
  const el = document.createElement('div');
  el.className = 'rails-zone';
  if (z.type === 'tab-insert') el.classList.add('rails-zone-insert');
  if (z.type === 'new-float') el.classList.add('rails-zone-float');
  if (z.type === 'gap') el.classList.add('rails-zone-new');
  if (z.type === 'edge' || z.type === 'workspace-edge') el.classList.add('rails-zone-split');
  el.style.left = z.rect.x + 'px';
  el.style.top = z.rect.y + 'px';
  el.style.width = z.rect.w + 'px';
  el.style.height = z.rect.h + 'px';
  inst.host.appendChild(el);
  return el;
}

// Zones for a tab drag — includes new-float.
function computeZones(inst, tab, touch) {
  const zones = collectDockZones(inst, tab);
  collectFloatStackZones(inst, zones);
  collectFloatTitlebarZones(inst, zones);
  const dropZones = inst.config.dropZones || {};
  if (dropZones['new-float'] !== false) {
    const wsRect = inst.host.getBoundingClientRect();
    zones.push({
      type: 'new-float',
      rect: { x: 0, y: 0, w: wsRect.width, h: wsRect.height },
      priority: 'new-float',
    });
  }
  if (touch) inflateZonesForTouch(zones);
  return filterZones(inst, zones, tab);
}

// Expand narrow drop zones so they remain usable with finger-sized pointers.
function inflateZonesForTouch(zones) {
  for (const z of zones) {
    // tab-insert halves are already wide; nudge the hit rect a touch more so
    // finger-sized pointers comfortably cover the boundary.
    if (z.type === 'tab-insert') {
      const t = z.hit || z.rect;
      t.x -= 4;
      t.w += 8;
    }
    // gaps between split children — widen from 18px to 30px.
    if (z.type === 'gap') {
      if (z.rect.w < 20) { z.rect.x -= 6; z.rect.w += 12; }
      if (z.rect.h < 20) { z.rect.y -= 6; z.rect.h += 12; }
    }
  }
}

// Zones for float redock (float titlebar dragged onto rails) — rails-only,
// no new-float (can't redock into another new float). excludeFloatId skips
// the dragging float's own titlebar / strip / body zones so self-drops don't
// happen.
function computeRedockZones(inst, tab, excludeFloatId) {
  const zones = collectDockZones(inst, null);
  collectFloatStackZones(inst, zones, excludeFloatId);
  collectFloatTitlebarZones(inst, zones, excludeFloatId);
  return filterZones(inst, zones, tab);
}

function filterZones(inst, zones, tab) {
  if (inst.callbacks.canDropOn) {
    return zones.filter(z => inst.callbacks.canDropOn(z, tab));
  }
  return zones;
}

// Docked drop zones:
//   gap            — the band between two children of a split: a new stack
//                    lands there, between them;
//   edge           — a band along each side of a stack's body: splits that
//                    stack (left/right side by side, top/bottom one above
//                    the other). The preview rect is the half it would take;
//   workspace-edge — a thin band at the rim of the whole dock: a new stack
//                    along that side spanning everything (only when the root
//                    is a split; for a single stack it equals its edge zone);
// plus each stack's own tab-insert / tab-append zones.
// A smaller hit rect wins (updateTabDrag), so the rim beats a stack edge and
// a gap beats the edges it sits between.
const EDGE_FRACTION = 0.25;   // of the slot's width/height
const EDGE_MAX = 96;          // px
const RIM = 14;               // px

function collectDockZones(inst, draggedTab) {
  const zones = [];
  const root = inst.state.root;
  if (!root) return zones;
  const wsRect = inst.host.getBoundingClientRect();
  const dropZones = inst.config.dropZones || {};
  const enabled = (type) => dropZones[type] !== false;
  const local = r => ({ x: r.left - wsRect.left, y: r.top - wsRect.top, w: r.width, h: r.height });
  const elOf = n => inst.railsLayer.querySelector(`[data-node-id="${cssEscape(n.id)}"]`);

  // A tab dragged out of a stack it is alone in can't usefully split it.
  const src = draggedTab ? findTab(inst.state, draggedTab.id) : null;
  const loneSrcId = src && src.container === 'dock' && src.stack.tabs.length === 1 ? src.stack.id : null;

  const visit = (node) => {
    const el = elOf(node);
    if (!el || node.collapsed) return;
    if (isSplit(node)) {
      const row = node.dir !== 'col';
      const r = local(el.getBoundingClientRect());
      if (enabled('gap')) {
        for (let i = 0; i < node.children.length - 1; i++) {
          const ae = elOf(node.children[i]), be = elOf(node.children[i + 1]);
          if (!ae || !be) continue;
          const ar = ae.getBoundingClientRect(), br = be.getBoundingClientRect();
          const mid = row ? (ar.right + br.left) / 2 - wsRect.left
                          : (ar.bottom + br.top) / 2 - wsRect.top;
          zones.push({ type: 'gap', splitId: node.id, at: i + 1,
            rect: row ? { x: mid - 9, y: r.y, w: 18, h: r.h }
                      : { x: r.x, y: mid - 9, w: r.w, h: 18 } });
        }
      }
      node.children.forEach(visit);
      return;
    }
    if (enabled('edge') && node.id !== loneSrcId) {
      const slot = el.querySelector('.rails-slot');
      const sr = slot && slot.getBoundingClientRect();
      if (sr && sr.width > 0 && sr.height > 0) {
        const s = local(sr);
        const e = local(el.getBoundingClientRect());
        const bw = Math.min(EDGE_MAX, s.w * EDGE_FRACTION);
        const bh = Math.min(EDGE_MAX, s.h * EDGE_FRACTION);
        // Left/right bands run the full slot height; top/bottom bands fill the
        // middle between them, so no two edge bands overlap.
        const edges = [
          ['left',   { x: s.x, y: s.y, w: bw, h: s.h },                         { x: e.x, y: e.y, w: e.w / 2, h: e.h }],
          ['right',  { x: s.x + s.w - bw, y: s.y, w: bw, h: s.h },              { x: e.x + e.w / 2, y: e.y, w: e.w / 2, h: e.h }],
          ['top',    { x: s.x + bw, y: s.y, w: s.w - 2 * bw, h: bh },           { x: e.x, y: e.y, w: e.w, h: e.h / 2 }],
          ['bottom', { x: s.x + bw, y: s.y + s.h - bh, w: s.w - 2 * bw, h: bh }, { x: e.x, y: e.y + e.h / 2, w: e.w, h: e.h / 2 }],
        ];
        for (const [side, hit, rect] of edges) {
          if (hit.w > 0 && hit.h > 0) zones.push({ type: 'edge', nodeId: node.id, side, hit, rect });
        }
      }
    }
    collectStackInternalZones(zones, el, node, wsRect, enabled);
  };
  visit(root);

  if (isSplit(root) && enabled('workspace-edge')) {
    const re = elOf(root);
    if (re) {
      const r = local(re.getBoundingClientRect());
      const tw = r.w / 3, th = r.h / 3;
      const rims = [
        ['left',   { x: r.x, y: r.y, w: RIM, h: r.h },             { x: r.x, y: r.y, w: tw, h: r.h }],
        ['right',  { x: r.x + r.w - RIM, y: r.y, w: RIM, h: r.h }, { x: r.x + r.w - tw, y: r.y, w: tw, h: r.h }],
        ['top',    { x: r.x, y: r.y, w: r.w, h: RIM },             { x: r.x, y: r.y, w: r.w, h: th }],
        ['bottom', { x: r.x, y: r.y + r.h - RIM, w: r.w, h: RIM }, { x: r.x, y: r.y + r.h - th, w: r.w, h: th }],
      ];
      for (const [side, hit, rect] of rims) {
        zones.push({ type: 'workspace-edge', nodeId: root.id, side, hit, rect });
      }
    }
  }
  return zones;
}

// Push tab-insert / tab-append-strip / tab-append-body zones for a stack's
// rendered DOM. Used both for docked stacks (via collectDockZones) and for
// float-stacks (via collectFloatStackZones), so dropping into a float behaves
// the same as dropping into a docked stack — true mini-workspace semantics.
//
// A hidden strip (single-tab float, where rails.css collapses .rails-strip-wrap)
// reports a zero-area rect; we skip strip-derived zones in that case so we
// don't generate dead hit-targets. Body-append still applies — drops on the
// float's slot append to the existing stack rather than spawning a new float
// stacked on top.
function collectStackInternalZones(zones, stackEl, stack, wsRect, enabled) {
  const strip = stackEl.querySelector('.rails-strip');
  if (strip) {
    const stripRect = strip.getBoundingClientRect();
    const stripVisible = stripRect.width > 0 && stripRect.height > 0;
    const top = stripRect.top - wsRect.top;
    const h = stripRect.height;
    const tabEls = stripVisible ? strip.querySelectorAll('.rails-tab') : [];

    // Each tab is split into two half-width INSERT targets — left half inserts
    // before it, right half after — so anywhere over a tab is a precise drop
    // point (no more 6px slivers). The wide `hit` rect drives detection; the
    // thin `rect` is just a 2px caret drawn at the boundary, so the tabs stay
    // fully visible during the drag (the target paints nothing). This is the
    // VS-Code / browser tab-reorder model.
    if (stripVisible && enabled('tab-insert') && tabEls.length) {
      tabEls.forEach((t, ti) => {
        const r = t.getBoundingClientRect();
        const x = r.left - wsRect.left;
        const mid = r.width / 2;
        zones.push({ type: 'tab-insert', stackId: stack.id, at: ti,
          rect: { x: x - 1, y: top, w: 2, h },
          hit:  { x, y: top, w: mid, h } });
        zones.push({ type: 'tab-insert', stackId: stack.id, at: ti + 1,
          rect: { x: x + r.width - 1, y: top, w: 2, h },
          hit:  { x: x + mid, y: top, w: r.width - mid, h } });
      });
    }

    // Append zone — only the EMPTY strip space past the last tab (or the whole
    // strip when there are no tabs). It never overlaps a tab, so it can't hide
    // one. With tab-insert disabled it falls back to covering the whole strip.
    if (stripVisible && enabled('tab-append-strip')) {
      if (!tabEls.length || !enabled('tab-insert')) {
        zones.push({ type: 'tab-append', stackId: stack.id,
          rect: { x: stripRect.left - wsRect.left, y: top, w: stripRect.width, h } });
      } else {
        const lastRight = tabEls[tabEls.length - 1].getBoundingClientRect().right - wsRect.left;
        const stripRight = stripRect.right - wsRect.left;
        if (stripRight - lastRight > 2) {
          zones.push({ type: 'tab-append', stackId: stack.id,
            rect: { x: lastRight, y: top, w: stripRight - lastRight, h } });
        }
      }
    }
  }

  if (enabled('tab-append-body')) {
    const slot = stackEl.querySelector('.rails-slot');
    if (slot) {
      const slotRect = slot.getBoundingClientRect();
      if (slotRect.width > 0 && slotRect.height > 0) {
        zones.push({ type: 'tab-append', stackId: stack.id,
          rect: { x: slotRect.left - wsRect.left, y: slotRect.top - wsRect.top,
                  w: slotRect.width, h: slotRect.height },
          priority: 'body-append' });
      }
    }
  }
}

// Per-stack drop zones for floats — same set as docked stacks but sourced from
// the floats sublayer. Skips minimized/maximized floats (no usable strip/slot)
// and the dragging float's own zones (excludeFloatId) so a redock can't drop
// the float onto itself.
function collectFloatStackZones(inst, zones, excludeFloatId) {
  if (!Array.isArray(inst.state.floats)) return;
  const wsRect = inst.host.getBoundingClientRect();
  const dropZones = inst.config.dropZones || {};
  const enabled = (type) => dropZones[type] !== false;
  for (const float of inst.state.floats) {
    if (float.id === excludeFloatId) continue;
    if (float.minimized) continue;
    if (!float.stack) continue;
    const stackEl = inst.floatsLayer?.querySelector(
      `.rails-float[data-float-id="${cssEscape(float.id)}"] .rails-stack`
    );
    if (!stackEl) continue;
    collectStackInternalZones(zones, stackEl, float.stack, wsRect, enabled);
  }
}

function collectFloatTitlebarZones(inst, zones, excludeFloatId) {
  const wsRect = inst.host.getBoundingClientRect();
  const dropZones = inst.config.dropZones || {};
  if (dropZones['float-titlebar'] === false) return;
  for (const float of inst.state.floats || []) {
    if (float.id === excludeFloatId) continue;
    if (float.minimized || float.maximized) continue;
    const floatEl = inst.floatsLayer?.querySelector(`.rails-float[data-float-id="${cssEscape(float.id)}"]`);
    if (!floatEl) continue;
    const titlebar = floatEl.querySelector('.rails-titlebar');
    if (!titlebar) continue;
    const tr = titlebar.getBoundingClientRect();
    zones.push({
      type: 'float-titlebar',
      floatId: float.id,
      rect: { x: tr.left - wsRect.left, y: tr.top - wsRect.top,
              w: tr.width, h: tr.height },
    });
  }
}

function zoneToMoveTarget(zone) {
  switch (zone.type) {
    case 'gap':            return { to: 'insert', splitId: zone.splitId, at: zone.at };
    case 'edge':
    case 'workspace-edge': return { to: 'split', nodeId: zone.nodeId, side: zone.side };
    case 'tab-insert':     return { to: 'stack', stackId: zone.stackId, at: zone.at };
    case 'tab-append':     return { to: 'stack', stackId: zone.stackId };
    case 'new-float':      return { to: 'new-float', x: zone._cursorX ?? 100, y: zone._cursorY ?? 100 };
    case 'float-titlebar': return { to: 'float', floatId: zone.floatId };
    default:               return null;
  }
}

function applyMoveTarget(inst, tab, zone, srcStack) {
  if (isNewStackZone(zone)) {
    const ns = { id: inst._freshId('s'), tabs: [tab], active: tab.id };
    placeStack(inst.state, zoneToMoveTarget(zone), ns);
  } else if (zone.type === 'tab-insert') {
    const target = findStack(inst.state, zone.stackId)?.stack;
    if (target) {
      let at = zone.at;
      if (target === srcStack) at = Math.min(at, target.tabs.length);
      target.tabs.splice(at, 0, tab);
      target.active = tab.id;
    }
  } else if (zone.type === 'tab-append') {
    const target = findStack(inst.state, zone.stackId)?.stack;
    if (target) {
      target.tabs.push(tab);
      target.active = tab.id;
    }
  } else if (zone.type === 'new-float') {
    const cx = zone._cursorX ?? 100;
    const cy = zone._cursorY ?? 100;
    const w = inst.config.defaultFloatSize?.w ?? 400;
    const h = inst.config.defaultFloatSize?.h ?? 300;
    const maxZ = Math.max(0, ...(inst.state.floats || []).map(f => f.z));
    const stack = { id: inst._freshId('s'), flex: 1, tabs: [tab], active: tab.id };
    const float = {
      id: inst._freshId('f'),
      stack,
      x: cx, y: cy, w, h,
      z: maxZ + 1,
    };
    if (!Array.isArray(inst.state.floats)) inst.state.floats = [];
    inst.state.floats.push(float);
  } else if (zone.type === 'float-titlebar') {
    const float = findFloat(inst.state, zone.floatId);
    if (float && float.stack) {
      float.stack.tabs.push(tab);
      float.stack.active = tab.id;
    }
  }
}
