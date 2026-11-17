// micro — menus: the one popup menu every menubar entry, context menu and dropdown opens.
// menuXY(x, y, items, onCancel) at a point, menuAt(anchor, items) under an element;
// items may nest ({ submenu }) and open on hover, or on a tap after a touch.
import { topZ } from './windows.js';
import { t } from './i18n.js';
const $ = (s) => document.querySelector(s);

// ── menubar (lamina's compact menuAt pattern — commands in menus, knobs in the bar) ──
export let _menuEl = null;                                        // the ROOT menu (compat alias for _menuChain[0])

export let _menuDoc = null;                                       // the dismiss listener — owned by closeMenu

export let _menuChain = [];                                       // root → open submenu → … (hover-nested)

export function closeMenu() {
  for (const m of _menuChain) m.remove();
  _menuChain = []; _menuEl = null;
  if (_menuDoc) { removeEventListener('pointerdown', _menuDoc); _menuDoc = null; }
}

// close every menu deeper than `level` in the chain
export function _closeDeeperThan(level) { while (_menuChain.length > level + 1) _menuChain.pop().remove(); }

export function _buildMenu(items) {
  const m = document.createElement('div'); m.className = 'menu';
  for (const it of items) {
    if (it.sep) { const d = document.createElement('div'); d.className = 'sep'; m.appendChild(d); continue; }
    const d = document.createElement('div'); d.className = 'item'; d._item = it;
    // a lone lowercase word is usually DATA (a column, a bookmark): left as it is
    const lab = document.createElement('span'); lab.textContent = /^[a-z_][\w.]*$/.test(String(it.label)) ? it.label : t(it.label); d.appendChild(lab);
    if (it.submenu) { const c = document.createElement('span'); c.className = 'kbd sub'; c.textContent = '▸'; d.appendChild(c); }
    else if (it.kbd) { const kb = document.createElement('span'); kb.className = 'kbd'; kb.textContent = it.kbd; d.appendChild(kb); }
    m.appendChild(d);
  }
  return m;
}

export function _placeMenu(m, x, y) {
  document.body.appendChild(m);
  m.style.zIndex = topZ() + 1 + _menuChain.length;         // each level above the last, all above float windows
  const mw = m.offsetWidth || 180, mh = m.offsetHeight || 40;
  m.style.left = Math.max(2, Math.min(x, innerWidth - mw - 4)) + 'px';
  m.style.top = Math.max(2, Math.min(y, innerHeight - mh - 4)) + 'px';
}

// a TOUCH tap fires an emulated mouseenter before its click: the submenu opened under
// the finger (flipped over the parent on a narrow screen) and the click landed on one
// of ITS items — Tools → Recipes ran "open a project…". After a touch, hover opens
// nothing; the parent row's click opens it instead.
export let _menuPtr = 'mouse';
addEventListener('pointerdown', (e) => { _menuPtr = e.pointerType || 'mouse'; }, true);
export function _wireMenu(m, level) {
  m.querySelectorAll('.item').forEach((d) => {
    const it = d._item;
    d.addEventListener('mouseenter', () => { if (_menuPtr !== 'touch') openSub(); });
    const openSub = () => {
      if (_menuChain[level + 1] && _menuChain[level + 1]._forItem === d) return;   // its submenu is already open
      _closeDeeperThan(level);                             // hovering a sibling closes the old submenu
      if (!it || !it.submenu) return;
      const items = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
      if (!items || !items.length) return;
      const sub = _buildMenu(items); sub._forItem = d;
      const r = d.getBoundingClientRect();
      _menuChain.push(sub);
      _placeMenu(sub, r.right - 3, r.top - 5);             // adjacent to the right, aligned to the item
      const sw = sub.offsetWidth || 180;
      if (r.right - 3 + sw > innerWidth - 4) sub.style.left = Math.max(2, r.left - sw + 3) + 'px';   // flip left if it would overflow
      _wireMenu(sub, level + 1);
    };
    d.addEventListener('click', (e) => {
      if (it && it.submenu && !it.action) { e.stopPropagation(); openSub(); return; }   // parent row: open, don't dismiss
      closeMenu(); if (it && it.action) it.action();
    });
  });
}

// menuXY(x, y, items, onCancel). Items may carry { submenu: [...] | () => [...] }
// for HOVER-opened nested menus (adjacent, parent stays open); { action } items
// click-close as before, so both styles coexist.
export function menuXY(x, y, items, onCancel) {
  closeMenu();
  const m = _buildMenu(items);
  _menuChain.push(m); _menuEl = m;
  _placeMenu(m, x, y);
  _wireMenu(m, 0);
  // dismiss on a pointerdown OUTSIDE the whole chain (a sibling menu replacing
  // this one leaks nothing — closeMenu owns the listener)
  setTimeout(() => {
    if (_menuChain[0] !== m) return;
    const onDoc = (e) => { if (!_menuChain.some((mm) => mm.contains(e.target))) { closeMenu(); if (onCancel) onCancel(); } };
    _menuDoc = onDoc;
    addEventListener('pointerdown', onDoc);
  }, 0);
}

export function menuAt(anchor, items) {
  let r = anchor.getBoundingClientRect();
  if (!r.width && !r.height) r = $('#btnBurger').getBoundingClientRect();   // phone: the menubar lives behind the burger
  menuXY(r.left, r.bottom + 2, items);
}
