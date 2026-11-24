// micro dialogs — one lifecycle for every #…Dlg overlay (modal flow gates and modeless
// operation dialogs on the shared float z order, Escape closes the topmost), the prompt /
// confirm and help overlays, Android Back closing what's on top, Ctrl+` cycling the floats.
// Carved from index.html (2026-11-24).
import { nextZ, _isMobile, raiseWindow } from './windows.js';
import { _propOpen, closeProps } from './props.js';
import { closeLayersPanel } from './layers-panel.js';
import { _measure, clearMeasure } from './overlay.js';
import { pmClose, _pmOkValue } from './prompts.js';
import { _menuChain, closeMenu } from './menu.js';
import { acClose } from './exprfield.js';
import { _fdOpen, toggleFilterDrawer } from './filter-drawer.js';
import { _selArm, disarmSelect } from './selection.js';
import { PAINT, paintDisarm } from './paint.js';
import { _knifeArm, armKnife } from './section.js';
import { _palOpen, closePalette } from './palette.js';

const $ = (s) => document.querySelector(s);

$('#plClose').onclick = () => { $('#plDlg').classList.remove('show'); };
$('#pmOk').onclick = () => pmClose(_pmOkValue !== undefined ? _pmOkValue : $('#pmInput').value);
$('#pmCancel').onclick = () => pmClose(null);
$('#pmDlg').addEventListener('pointerdown', (e) => { if (e.target === $('#pmDlg')) pmClose(null); });
$('#pmInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); pmClose($('#pmInput').value); }
});
$('#pmDlg').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pmClose(null); }
});
$('#helpClose').onclick = () => $('#help').classList.remove('show');
$('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').classList.remove('show'); });

// ── dialog lifecycle — one manager for every #…Dlg overlay ──────────────────
// Two kinds, one contract. MODAL = flow gates (open/import/save/progress):
// centered, backdrop, backdrop-click cancels. MODELESS = operation config that
// references the scene (select-by-solid, new grid, surface tools, exports,
// rename): same markup, no backdrop — drag it aside, orbit, then Run. Both
// stack on the shared float z counter (last opened lands on top — the static
// z-index:8 CSS made DOM order win, so a NEWER dialog could open UNDER an
// older one) and Escape closes the topmost. pmDlg (prompt/confirm) manages
// itself; plDlg is a progress gate (no Escape, no backdrop-cancel).
const _DLG_MODELESS = ['sbDlg', 'adDlg', 'ngDlg', 'rgDlg', 'sfDlg', 'exDlg', 'meDlg', 'brDlg'];
const _DLG_MODAL = ['dhDlg', 'ofDlg', 'svDlg', 'opDlg', 'plDlg'];
const _dlgStack = [];
let _dlgSpawn = 0;
function _dlgCancel(id) {
  const el = $('#' + id); if (!el || !el.classList.contains('show')) return;
  const x = el.querySelector('.hd button');                // the × — runs the dialog's own cleanup
  if (x) x.click();
  if (el.classList.contains('show')) el.classList.remove('show');
}
function _dlgPlace(el) {
  const box = el.querySelector('.box'); if (!box || box.style.left) return;   // keep position across re-opens
  const w = box.offsetWidth || 480;
  box.style.left = Math.max(8, Math.round(innerWidth / 2 - w / 2) + (_dlgSpawn % 5) * 26) + 'px';
  box.style.top = (84 + (_dlgSpawn % 5) * 22) + 'px';
  _dlgSpawn++;
}
for (const _id of [..._DLG_MODAL, ..._DLG_MODELESS]) {
  const el = $('#' + _id); if (!el) continue;
  const modeless = _DLG_MODELESS.includes(_id);
  if (modeless) el.classList.add('modeless');
  new MutationObserver(() => {
    const on = el.classList.contains('show'), i = _dlgStack.indexOf(_id);
    if (on) { if (i < 0) _dlgStack.push(_id); el.style.zIndex = nextZ(); if (modeless) _dlgPlace(el); }
    else if (i >= 0) _dlgStack.splice(i, 1);
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
  el.addEventListener('pointerdown', (e) => {
    el.style.zIndex = nextZ();                            // raise on interaction
    if (!modeless && _id !== 'plDlg' && e.target === el) _dlgCancel(_id);   // backdrop click cancels
  });
  const hd = el.querySelector('.hd'), box = el.querySelector('.box');
  if (modeless && hd && box) hd.addEventListener('pointerdown', (e) => {    // drag by the head
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    e.preventDefault();
    const r = box.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const move = (ev) => { box.style.left = Math.max(0, ev.clientX - sx) + 'px'; box.style.top = Math.max(28, ev.clientY - sy) + 'px'; };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
}
addEventListener('keydown', (e) => {                       // Escape: topmost dialog first, then help
  if (e.key !== 'Escape') return;
  const pm = $('#pmDlg'); if (pm && pm.classList.contains('show')) return;  // prompt/confirm handles itself
  const top = _dlgStack.filter((id) => id !== 'plDlg').pop();
  const help = $('#help');
  if (top) { _dlgCancel(top); e.preventDefault(); e.stopImmediatePropagation(); }
  else if (help && help.classList.contains('show')) { help.classList.remove('show'); e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
$('#help').addEventListener('pointerdown', (e) => { if (e.target === $('#help')) $('#help').classList.remove('show'); });
// ── Android Back (the phone): close what's on top instead of leaving micro. While anything
// closable is open, ONE sentinel history entry sits on the stack; Back pops it, we close
// the topmost thing and re-arm if more is open. Closing things by hand takes the sentinel
// back off (a quiet history.back()), so Back with nothing open leaves as it always did.
// Never the desktop, and never anything destructive: a selection or a section stays.
const _BACK_STEPS = [
  [() => _menuChain.length > 1, () => _menuChain.pop().remove()],                 // a submenu, then its menu
  [() => _menuChain.length > 0, () => closeMenu()],
  [() => $('#pmDlg').classList.contains('show'), () => pmClose(null)],
  [() => $('#acPopup').classList.contains('show'), () => acClose()],
  [() => _palOpen, () => closePalette()],
  [() => _dlgStack.some((id) => id !== 'plDlg'), () => _dlgCancel(_dlgStack.filter((id) => id !== 'plDlg').pop())],
  [() => $('#help').classList.contains('show'), () => $('#help').classList.remove('show')],
  [() => _fdOpen, () => toggleFilterDrawer(false)],
  [() => $('#recPanel').classList.contains('show'), () => $('#rpClose').click()],
  [() => _propOpen, () => closeProps()],
  [() => $('#layersPanel').classList.contains('show'), () => closeLayersPanel()],
  [() => !!_backTopWindow(), () => _backTopWindow()._minimize()],                  // a window sheet goes to its chip
  [() => _knifeArm, () => { armKnife(false); $('#secMode').value = 'off'; $('#secMode').dispatchEvent(new Event('input')); }],
  [() => !!PAINT.arm, () => paintDisarm()],
  [() => !!_selArm, () => disarmSelect()],
  [() => !!(_measure.arm || _measure.b), () => clearMeasure()],
];
function _backTopWindow() {
  let top = null;
  for (const w of document.querySelectorAll('.fwin')) if (w.style.display !== 'none' && w._minimize && (!top || (+w.style.zIndex || 0) > (+top.style.zIndex || 0))) top = w;
  return top;
}
// The quiet history.back() is ASYNCHRONOUS. While it is in flight nothing touches the
// history: a sentinel pushed then would be the entry that back() pops, the counters
// and the stack would disagree, and a later quiet back would pop past micro's own
// page — Back leaving micro, the thing this guard exists to stop. Once it lands, the
// guard re-checks (something may have opened meanwhile).
let _backArmed = false, _backPending = false, _backRaf = 0;
const _backOpen = () => _isMobile() && _BACK_STEPS.some(([open]) => open());
function syncBackGuard() {
  if (_backRaf || _backPending) return;
  _backRaf = requestAnimationFrame(() => {
    _backRaf = 0;
    if (_backPending) return;
    const open = _backOpen();
    if (open && !_backArmed) { history.pushState({ microBack: 1 }, ''); _backArmed = true; }
    else if (!open && _backArmed) { _backArmed = false; _backPending = true; history.back(); }
  });
}
addEventListener('popstate', () => {
  if (_backPending) { _backPending = false; syncBackGuard(); return; }   // our own quiet back landed
  if (!_backArmed) return;                                 // a real navigation, not ours
  _backArmed = false;
  const step = _isMobile() && _BACK_STEPS.find(([open]) => open());
  if (step) step[1]();
  syncBackGuard();                                         // more still open → a fresh sentinel
});
new MutationObserver(syncBackGuard).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
// the transient overlays join the same stacking order when they appear — their static
// z-indexes (9 · 30 · 31 · 50) sat under every float window (41+), so a confirm, the
// help, the filter drawer or autocomplete could open BEHIND a window or a phone sheet
for (const _id of ['pmDlg', 'help', 'fdrawer', 'acPopup']) {
  const el = $('#' + _id); if (!el) continue;
  new MutationObserver(() => { if (el.classList.contains('show')) el.style.zIndex = nextZ(); })
    .observe(el, { attributes: true, attributeFilter: ['class'] });
}
addEventListener('keydown', (e) => {                       // Ctrl+` cycles the floats — the bottom-most rises
  if (e.key !== '`' || !e.ctrlKey || e.altKey || e.metaKey) return;
  const wins = [...document.querySelectorAll('.fwin')].filter((x) => x.style.display !== 'none');
  if (!wins.length) return;
  e.preventDefault();
  wins.sort((a, b2) => (+a.style.zIndex || 0) - (+b2.style.zIndex || 0));
  raiseWindow(wins[0]);
});
