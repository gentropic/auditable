// micro on a phone — REVIEW MODE (spec_inbox/micro-mobile-spec.md): below the breakpoint, or
// with ?mobile=1, the SAME elements move into a different host layout (a bottom tool bar, a
// section strip, panels and windows as bottom sheets that the view yields to). Carved from
// index.html (2026-11-24).
import { setHTML, trusted } from './html.js';
import { S, requestRender } from './state.js';
import { _isMobile, relayoutWindows, _sheetDrag } from './windows.js';
import { _propOpen, closeProps, openProps } from './props.js';
import { toggleLayersPanel, closeLayersPanel } from './layers-panel.js';
import { syncSelBar } from './selection.js';
import { expandRecCard } from './pick.js';
import { renderer, cam } from './viewport.js';

const $ = (s) => document.querySelector(s);

// REVIEW MODE (spec_inbox/micro-mobile-spec.md): below the breakpoint — or with
// ?mobile=1 so the desktop smokes can emulate a phone — the SAME elements move
// into a different host layout: the tool buttons to a bottom bar (ids, listeners
// and lit states travel with them), the section controls to a strip, every
// floating thing becomes a bottom sheet (floatWin + the panels). Desktop puts
// everything back where it came from.
const _mqPhone = matchMedia('(max-width: 720px), (max-height: 500px) and (pointer: coarse)');   // a phone held sideways is wide but short
const _forceMobile = new URLSearchParams(location.search).get('mobile') === '1';

const _TOOLROW = ['#btnSelRect', '#btnSelLasso', '#btnSelThrough', '#btnPaint', '#btnMeasure', '#btnSection', '#btnShot', '#btnFit'];
const _TOOLROW_MOBILE = ['#btnLayersM', '#btnPropsM', '#btnSelRect', '#btnSection', '#btnMeasure', '#btnFit'];
const _TOOL_LABELS = { btnLayersM: 'layers', btnPropsM: 'props', btnSelRect: 'select', btnSection: 'section', btnMeasure: 'measure', btnFit: 'fit' };
const _home = new Map();                                   // element → where it lives on the desktop
function _moveTo(el, host) { if (!_home.has(el)) _home.set(el, { parent: el.parentNode, next: el.nextSibling }); host.appendChild(el); }
function _moveHome(el) { const h = _home.get(el); if (h && h.parent) h.parent.insertBefore(el, h.next && h.next.parentNode === h.parent ? h.next : null); }
function ensureMobileChrome() {
  if ($('#btnLayersM')) return;
  const mk = (id, title, svg) => { const b = document.createElement('button'); b.id = id; b.title = title; setHTML(b, trusted(svg)); return b; };
  const layersB = mk('btnLayersM', 'layers', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 10 6-10 6L2 8z"/><path d="m2 13 10 6 10-6"/></svg>');
  const propsB = mk('btnPropsM', 'properties of the active layer', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="var(--bg-bar)"/><circle cx="15" cy="12" r="2" fill="var(--bg-bar)"/><circle cx="7" cy="18" r="2" fill="var(--bg-bar)"/></svg>');
  layersB.onclick = () => toggleLayersPanel();
  propsB.onclick = () => { if (_propOpen) closeProps(); else if (S.activeId != null) openProps(); else $('#meta').textContent = 'no active layer — open a file first'; };
  $('#barTools').append(layersB, propsB);
  for (const id in _TOOL_LABELS) { const b = $('#' + id); if (b && !b.querySelector('.tl')) { const l = document.createElement('span'); l.className = 'tl'; l.textContent = _TOOL_LABELS[id]; b.appendChild(l); } }
  // the slab steppers — the Alt-wheel behaviour (×1.15 per step), as buttons
  const step = (up) => { if ($('#secClip').value !== 'slab') return; const cur = Math.max(0.5, +$('#secHalf').value || 5); $('#secHalf').value = Math.max(0.5, +(cur * (up ? 1.15 : 1 / 1.15)).toPrecision(3)); $('#secHalf').dispatchEvent(new Event('input')); $('#meta').textContent = `slab half-thickness ${+$('#secHalf').value} m`; };
  $('#secThin').onclick = () => step(false); $('#secThick').onclick = () => step(true);
  // ⋯ — the second row: the instrument row's own controls, moved (so they stay the one source of truth)
  $('#secMoreBtn').onclick = () => document.body.classList.toggle('sec-more');
  for (const b of $('#secKeep').children) b.onclick = () => { $('#secClip').value = b.dataset.c; $('#secClip').dispatchEvent(new Event('input', { bubbles: true })); };
  for (const [id, text] of [['secDipDirL', 'dip dir'], ['secDipL', 'dip']]) { const l = document.createElement('label'); l.id = id; l.className = 'secNum'; l.textContent = text + ' '; $('#secExtra').appendChild(l); }
  new ResizeObserver(() => document.body.style.setProperty('--sec-x', $('#secExtra').offsetHeight + 'px')).observe($('#secExtra'));
  $('#secMode').addEventListener('input', () => document.body.classList.toggle('sec-on', _isMobile() && $('#secMode').value !== 'off'));
}
function layoutBars() {
  const mobile = _forceMobile || _mqPhone.matches;
  const was = document.body.classList.contains('mobile');
  document.body.classList.toggle('mobile', mobile);
  syncLand();
  if (was !== mobile) relayoutWindows(mobile);
  // a phone renders at most 2 device pixels per CSS pixel (an S24+'s 2.8 is ~2× the
  // fill for no visible gain); the CSS size didn't change, so resize by hand
  syncSelBar();
  renderer.setMaxPixelRatio(mobile ? 2 : Infinity);
  { const [w, h] = renderer.resize(); cam.setAspect(w / h); requestRender(); }
  ensureMobileChrome();
  if (mobile) {
    for (const sel of _TOOLROW) _moveTo($(sel), $('#bar'));             // park them (the hidden ones stay hidden by CSS)
    for (const sel of _TOOLROW_MOBILE) _moveTo($(sel), $('#barTools'));
    const strip = $('#secStrip'); strip.insertBefore($('#secMode'), $('#secThin')); strip.insertBefore($('#secPos'), $('#secThin'));
    _moveTo($('#secDipDir'), $('#secDipDirL')); _moveTo($('#secDip'), $('#secDipL'));
    for (const sel of _SEC_EXTRA_LABELS) _moveTo($(sel), $('#secExtra'));
  } else {
    for (const sel of _TOOLROW) _moveTo($(sel), $('#bar'));
    for (const sel of ['#btnLayersM', '#btnPropsM']) _moveTo($(sel), $('#barTools'));
    for (const sel of _SEC_MOVED) _moveHome($(sel));
  }
  document.body.classList.toggle('sec-on', mobile && $('#secMode').value !== 'off');
}
// record the section controls' desktop homes BEFORE the first layout moves them
const _SEC_EXTRA_LABELS = ['#secPlaneW', '#secFollowW', '#sec2DW'];
const _SEC_MOVED = ['#secMode', '#secPos', '#secDipDir', '#secDip', ..._SEC_EXTRA_LABELS];
for (const sel of _SEC_MOVED) { const el = $(sel); _home.set(el, { parent: el.parentNode, next: el.nextSibling }); }
// sideways: a phone layout whose height is the short side (rotating doesn't always cross
// the media query, so this follows every resize)
function syncLand() { document.body.classList.toggle('land', document.body.classList.contains('mobile') && innerWidth > innerHeight); }
_mqPhone.addEventListener('change', layoutBars);
addEventListener('resize', syncLand);
layoutBars();

// the view yields to whatever sheet is open: --sheet-inset = its height, so the
// canvas (a ResizeObserver resizes it) shrinks to the region above and the camera
// centre — hence the model — moves up with it. Re-measured on any sheet change.
let _sheetLayoutRaf = 0;
function _sheetLayout() {
  if (_sheetLayoutRaf) return;
  _sheetLayoutRaf = requestAnimationFrame(() => {
    _sheetLayoutRaf = 0;
    const bs = document.body.style;
    if (!_isMobile()) { bs.removeProperty('--sheet-inset'); bs.removeProperty('--sheet-inset-x'); return; }
    const land = document.body.classList.contains('land');
    let h = 0;
    for (const el of document.querySelectorAll('.fwin.sheet, #layersPanel.show, #propPanel.show, #recPanel.show:not(.card)')) {   // a pick card floats; the view doesn't yield to it
      if (el.style.display === 'none') continue;
      const rr = el.getBoundingClientRect();
      h = Math.max(h, land ? rr.width : rr.height);         // sideways the sheet docks right: the view gives up width
    }
    bs.setProperty('--sheet-inset', !land && h ? h + 'px' : '0px');
    bs.setProperty('--sheet-inset-x', land && h ? h + 'px' : '0px');
  });
}
new MutationObserver(_sheetLayout).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
addEventListener('resize', _sheetLayout);

// a pick card's handle: a tap or a pull toward the middle of the screen grows it into the
// record sheet; a flick toward its edge closes it
function _cardDrag(el, e, onDismiss) {
  const id = e.pointerId, y0 = e.clientY; let yLast = y0;
  const done = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); };
  const move = (ev) => { if (ev.pointerId === id) { yLast = ev.clientY; ev.preventDefault(); } };
  const cancel = (ev) => { if (ev.pointerId === id) done(); };
  const up = (ev) => {
    if (ev.pointerId !== id) return;
    done();
    const inward = (yLast - y0) * (el.classList.contains('card-top') ? 1 : -1);
    if (Math.abs(yLast - y0) < 8 || inward > 40) expandRecCard();
    else if (inward < -40) onDismiss();
  };
  addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', cancel);
}
for (const [id, head, dismiss] of [['#layersPanel', '.lp-head', () => closeLayersPanel()], ['#propPanel', '.rp-head', () => closeProps()], ['#recPanel', '.rp-head', () => $('#rpClose').click()]]) {
  const h = $(id) && ($(id).querySelector(head) || $(id).firstElementChild);
  if (h) {
    h.addEventListener('pointerdown', (e) => {
      if (!_isMobile() || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if ($(id).classList.contains('card')) { _cardDrag($(id), e, dismiss); return; }
      _sheetDrag($(id), e, dismiss);
    });
    // a click listener makes the head a TOUCH-ADJUSTMENT candidate: Chromium snaps a
    // tap near the WebGL canvas onto the canvas (it has listeners) unless the head is
    // itself "clickable" — found on the S24+, where every handle tap landed on #cv
    h.addEventListener('click', () => {});
  }
}
