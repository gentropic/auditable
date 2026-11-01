// micro windows — the float window every analysis, table and tool opens in: drag,
// resize, snap to edges, minimise to the strip, ONE stacking order (nextZ) shared
// with dialogs and menus — and, below 720px, the same window as a bottom SHEET
// (peek / half / tall, one at a time). Carved from index.html (phase 3).

const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setWindowsHooks): _propOpen, closeProps, toggleLayersPanel
let H = {};
export function setWindowsHooks(h) { H = h; }

export const _isMobile = () => document.body.classList.contains('mobile');

// one sheet at a time: showing a window or a panel minimizes the open windows
// (chips on the strip) and hides the other panels
export function _sheetExclusive(keep) {
  if (!_isMobile()) return;
  for (const w of document.querySelectorAll('.fwin')) if (w !== keep && w.style.display !== 'none' && w._minimize) w._minimize();
  const lp = $('#layersPanel'), pp = $('#propPanel'), rp = $('#recPanel');
  if (keep !== lp && lp.classList.contains('show')) H.toggleLayersPanel(false);
  if (keep !== pp && H._propOpen) H.closeProps();
  if (keep !== rp) rp.classList.remove('show');
}

// the handle: drag the head vertically to snap peek / half / tall; past peek closes (or minimizes a window)
export const _SHEET_H = ['38svh', '60svh', '92svh'];   // svh: the viewport WITH the browser's URL bar — vh is the bar-hidden one, so 92vh ran off the top

export function _sheetDrag(el, e, onDismiss) {
  const id = e.pointerId, y0 = e.clientY; let yLast = y0;
  let cur = _SHEET_H.indexOf(el.style.getPropertyValue('--sheet-h').trim()); if (cur < 0) cur = 1;
  const snap = (i) => { el.style.setProperty('--sheet-h', _SHEET_H[i]); if (el._onResized) requestAnimationFrame(() => el._onResized()); };
  const done = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); };
  const move = (ev) => { if (ev.pointerId !== id) return; yLast = ev.clientY; ev.preventDefault(); };
  // the browser took the gesture (a cancel carries no position): NOT a drag — leave the sheet alone
  const cancel = (ev) => { if (ev.pointerId === id) done(); };
  const up = (ev) => {
    if (ev.pointerId !== id) return;
    done();
    const dy = yLast - y0;
    if (Math.abs(dy) < 8) { snap(cur === 0 ? 1 : cur - 1); return; }          // a TAP on the handle steps the sheet down (peek ↔ half)
    if (dy > 70) { if (cur === 0) onDismiss(); else snap(cur - 1); }
    else if (dy < -70) snap(Math.min(2, cur + 1));
  };
  addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', cancel);
}

export function raiseWindow(el) {
  if (el._chip) { el._chip.remove(); el._chip = null; el.style.display = ''; }   // restore from the strip
  el.style.zIndex = nextZ();
  document.querySelectorAll('.fwin.top').forEach((w2) => { if (w2 !== el) w2.classList.remove('top'); });
  el.classList.add('top');                                 // the top float carries the accent head
}

// ── ATTRIBUTE TABLES (spec §11): floating, LAYER-PINNED windows — reading is
// stateful, so a table never re-targets under your scroll; one per layer,
// several open at once. A loom grid over the layer's O(1) fetchRecord
// (windowed rows via the sparse line index / fixed records / in-memory
// tables), ƒ columns included, an only-matches mode over the retained filter
// mask, and pick↔row sync both ways. Read-only: micro edits nothing. ──
export let _fwinZ = 40;

// the stacking order every float window, dialog and menu shares: nextZ() raises one to the top
export function nextZ() { return ++_fwinZ; }

export function topZ() { return _fwinZ; }

export function floatWin({ title, sub, x = 90, y = 90, w = 560, h = 320, onClose }) {
  // open ON the screen whatever the screen is — a phone gets the same window,
  // clamped (CSS max-width backs this up against later resizes)
  const kind = (String(title).split('·')[0] || '').trim() || 'win';   // "grade-tonnage · deposit.csv" → "grade-tonnage"
  let _geo = null; try { _geo = JSON.parse(localStorage.getItem('micro.winGeo.' + kind) || 'null'); } catch { /* private */ }
  if (_geo) {                                              // remembered per-kind geometry: size always,
    w = _geo.w || w; h = _geo.h || h;                      // position only when no sibling of the kind is open
    if (!document.querySelector('.fwin[data-kind="' + CSS.escape(kind) + '"]')) { x = _geo.x ?? x; y = _geo.y ?? y; }
  }
  w = Math.min(w, innerWidth - 12); h = Math.min(h, innerHeight - 72);
  x = Math.max(0, Math.min(x, innerWidth - w - 6)); y = Math.max(28, Math.min(y, innerHeight - h - 30));
  const el = document.createElement('div'); el.className = 'fwin'; el.dataset.kind = kind;
  if (_isMobile()) { el.classList.add('sheet'); el.style.cssText += `z-index:${nextZ()};`; el.style.setProperty('--sheet-h', '60svh'); }
  else el.style.cssText += `left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${nextZ()};`;
  const head = document.createElement('div'); head.className = 'fwin-head';
  const t = document.createElement('span'); t.className = 't'; t.textContent = title;
  const subEl = document.createElement('span'); subEl.className = 'sub'; subEl.textContent = sub || '';
  const minB = document.createElement('button'); minB.textContent = '–'; minB.title = 'minimize';
  const closeB = document.createElement('button'); closeB.textContent = '×';
  head.append(t, subEl, minB, closeB);
  const body = document.createElement('div'); body.className = 'fwin-body';
  const grip = document.createElement('div'); grip.className = 'fwin-grip';
  el.append(head, body, grip);
  document.body.appendChild(el);
  if (_isMobile()) _sheetExclusive(el);                      // one sheet at a time
  raiseWindow(el);
  el.addEventListener('pointerdown', () => raiseWindow(el));
  // a sub ending in "…" is a busy state — head shimmer + a thin bar across the body top
  const syncBusy = () => { const b2 = /(…|\.\.\.)\s*$/.test(subEl.textContent || ''); subEl.classList.toggle('busy', b2); el.classList.toggle('busy', b2); };
  new MutationObserver(syncBusy).observe(subEl, { childList: true, characterData: true, subtree: true });
  syncBusy();
  const saveGeo = () => {                                   // per-kind geometry memory (survives reloads)
    if (_isMobile() || el.style.display === 'none' || !el.offsetWidth) return;
    try { localStorage.setItem('micro.winGeo.' + kind, JSON.stringify({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })); } catch { /* private */ }
  };
  minB.onclick = () => {                                    // minimize → a titled chip on the bottom strip
    saveGeo(); el.style.display = 'none'; el.classList.remove('top');
    const chip = document.createElement('button'); chip.className = 'win-chip';
    chip.textContent = t.textContent; chip.title = 'restore ' + t.textContent;
    chip.onclick = () => { if (_isMobile()) _sheetExclusive(el); raiseWindow(el); };
    el._chip = chip; _winStrip().appendChild(chip);
  };
  el._minimize = () => minB.onclick();
  closeB.onclick = () => { saveGeo(); if (el._chip) { el._chip.remove(); el._chip = null; } el.remove(); if (onClose) onClose(); };
  head.addEventListener('click', () => {});                 // a touch-adjustment candidate (see the panel handles)
  head.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
    e.preventDefault();
    if (_isMobile()) { _sheetDrag(el, e, () => minB.onclick()); return; }   // the head is the sheet's handle
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    let zone = null;                                        // drag to a screen edge → half-snap (preview first)
    const move = (ev) => {
      el.style.left = Math.max(0, ev.clientX - sx) + 'px'; el.style.top = Math.max(28, ev.clientY - sy) + 'px';
      zone = ev.clientX < 14 ? 'left' : ev.clientX > innerWidth - 14 ? 'right' : null;
      _snapPreview(zone);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      _snapPreview(null);
      if (zone) {
        const g = _snapGeo(zone);
        el.style.left = g.x + 'px'; el.style.top = g.y + 'px'; el.style.width = g.w + 'px'; el.style.height = g.h + 'px';
        if (el._onResized) el._onResized();
      }
      saveGeo();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const sw2 = el.offsetWidth - e.clientX, sh2 = el.offsetHeight - e.clientY;
    const move = (ev) => { el.style.width = Math.max(300, ev.clientX + sw2) + 'px'; el.style.height = Math.max(120, ev.clientY + sh2) + 'px'; };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (el._onResized) el._onResized(); saveGeo(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  return { el, body, head, sub: subEl, close: () => closeB.onclick() };
}

// the minimized-window strip + edge-snap helpers
export function _winStrip() { let s2 = $('#winStrip'); if (!s2) { s2 = document.createElement('div'); s2.id = 'winStrip'; document.body.appendChild(s2); } return s2; }

export function _snapGeo(zone) {
  const top = 92, bot = 30;                                 // below the instrument rail, above the status bar
  const W2 = Math.floor(innerWidth / 2);
  return { x: zone === 'left' ? 6 : W2 + 3, y: top, w: W2 - 9, h: innerHeight - top - bot };
}

export function _snapPreview(zone) {
  let p2 = $('#snapPreview');
  if (!zone) { if (p2) p2.remove(); return; }
  if (!p2) { p2 = document.createElement('div'); p2.id = 'snapPreview'; document.body.appendChild(p2); }
  const g = _snapGeo(zone);
  p2.style.cssText = 'left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w + 'px;height:' + g.h + 'px;';
}
