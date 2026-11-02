// micro long-press — a touch held still opens the context menu. iOS never fires
// `contextmenu` (Android does, on its own timing), and every layer, group, rule
// and column row keeps its actions behind one. One listener for the whole page:
// a press held LONG_MS within SLOP_PX dispatches a synthetic contextmenu at the
// finger on the element under it, so every existing oncontextmenu works as is.
//
// Android's own long-press contextmenu can arrive too: whichever comes second
// within DEDUPE_MS is swallowed, so a row never opens two menus. The click that
// follows a long-press is swallowed as well — lifting the finger must not also
// activate the row it was holding.
const LONG_MS = 500, SLOP_PX = 10, DEDUPE_MS = 900;

export function installLongPress({ exclude = 'input, textarea, select, [contenteditable]' } = {}) {
  // the click to swallow is the one the HOLDING finger makes when it lifts (the menu
  // opened under it — that click would run the item it lands on), however long it
  // was held: armed at the menu, timed from that pointerup
  let timer = 0, sx = 0, sy = 0, target = null, lastMenuAt = -1e9, swallowClickUntil = 0, held = false, touchAt = -1e9;
  const cancel = () => { if (timer) clearTimeout(timer); timer = 0; target = null; };
  addEventListener('pointerdown', (e) => {
    cancel();
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    touchAt = performance.now();
    if (!e.isPrimary || !(e.target instanceof Element) || e.target.closest(exclude)) return;
    sx = e.clientX; sy = e.clientY; target = e.target;
    timer = setTimeout(() => {
      const t = target; timer = 0; target = null;
      if (!t || !t.isConnected) return;
      if (performance.now() - lastMenuAt < DEDUPE_MS) return;    // the platform's own menu beat us to it
      lastMenuAt = performance.now();
      held = true;
      try { navigator.vibrate && navigator.vibrate(8); } catch { /* not allowed — fine */ }
      t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 2 }));
    }, LONG_MS);
  }, true);
  addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > SLOP_PX) cancel(); }, true);
  addEventListener('pointerup', () => { if (timer) cancel(); if (held) { held = false; swallowClickUntil = performance.now() + 400; } }, true);
  addEventListener('pointercancel', cancel, true);
  addEventListener('contextmenu', (e) => {
    if (!e.isTrusted) return;                                   // ours
    // only the platform's LONG-PRESS menu concerns us — a right-click (or any menu
    // outside a touch press) is the desktop's and passes untouched
    if (e.pointerType === 'mouse' || performance.now() - touchAt > 3000) return;
    if (performance.now() - lastMenuAt < DEDUPE_MS) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    cancel();                                                   // the platform's came first: let it through, ours stands down
    lastMenuAt = performance.now();
    held = true;
  }, true);
  addEventListener('click', (e) => {
    if (performance.now() < swallowClickUntil) { swallowClickUntil = 0; e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

// a visible ⋯ for a row whose actions live in its context menu: the same menu, by tap
export function moreButton(row) {
  const b = document.createElement('button');
  b.className = 'row-more'; b.type = 'button'; b.textContent = '⋯'; b.title = 'actions'; b.setAttribute('aria-label', 'actions');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom, button: 2 }));
  });
  return b;
}
