// micro canvas input — what a pointer does ON the 3D view beyond orbiting: measure clicks
// and the touch crosshair, click-to-pick with the touch allowance, a finger's double tap (fit /
// orbit about a spot), and the magnifier loupe. Carved from index.html (2026-11-24).
import { setHTML, trusted } from './html.js';
import { requestRender } from './state.js';
import { _isMobile } from './windows.js';
import { _measure, drawMeasure, measureClick } from './overlay.js';
import { _selArm } from './selection.js';
import { PAINT } from './paint.js';
import { currentSection, _knifeArm } from './section.js';
import { nearPick, TOUCH_PICK_R, showPickAt } from './pick.js';
import { cv, _viewMode, renderer, cam, pivotOn } from './viewport.js';

const $ = (s) => document.querySelector(s);

// the rubber band follows the mouse between the two clicks
cv.addEventListener('pointermove', (e) => {
  if (!_measure.arm || !_measure.a || _measure.b) return;
  const r = cv.getBoundingClientRect();
  _measure.mouse = [e.clientX - r.left, e.clientY - r.top];
  drawMeasure();
});
// measure clicks pre-empt pick/orbit while armed (capture phase, like the knife)
cv.addEventListener('pointerdown', (e) => {
  if (!_measure.arm || e.button !== 0) return;
  e.stopImmediatePropagation(); e.preventDefault();
  const r = cv.getBoundingClientRect();
  if (e.pointerType === 'touch') { measureAim(e); return; }
  measureClick(e.clientX - r.left, e.clientY - r.top);
}, { capture: true });
// a FINGER covers what it measures. A quick tap measures where it lands (with the touch
// pick's 16 px allowance); press and slide (or hold) and a crosshair rides 64 px above the
// finger — aim it, lift, and the point is taken under the crosshair. A second finger
// cancels the aim.
const AIM_DY = 64;
let _aim = null;                                           // { id, x0, y0, t0, on, x, y } — canvas css px
function aimSvg() {
  let s = $('#aimSvg');
  if (!s) {
    s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.id = 'aimSvg';
    s.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;z-index:2');
    setHTML(s, trusted('<g id="aimG" stroke-linecap="round"><circle r="13" fill="none" stroke="#121212" stroke-width="4"/><circle r="13" fill="none" stroke="#ff26b3" stroke-width="1.6"/>'
      + '<path d="M-22 0H-6M6 0H22M0 -22V-6M0 6V22" stroke="#121212" stroke-width="4"/><path d="M-22 0H-6M6 0H22M0 -22V-6M0 6V22" stroke="#ff26b3" stroke-width="1.6"/><circle r="1.6" fill="#ff26b3"/></g>'));
    $('#view').appendChild(s);
  }
  return s;
}
function drawAim() {
  const s = aimSvg();
  if (!_aim || !_aim.on) { s.style.display = 'none'; hideLoupe(); return; }
  s.style.display = '';
  drawLoupe(_aim.x, _aim.y);                               // the magnifier over the crosshair's spot
  s.querySelector('#aimG').setAttribute('transform', `translate(${_aim.x} ${_aim.y})`);
  if (_measure.a && !_measure.b) { _measure.mouse = [_aim.x, _aim.y]; drawMeasure(); }
}
function measureAim(e) {
  if (_aim) { _aim = null; drawAim(); return; }            // a second finger: never mind
  const r = cv.getBoundingClientRect();
  const id = e.pointerId, x0 = e.clientX - r.left, y0 = e.clientY - r.top;
  _aim = { id, x0, y0, t0: performance.now(), on: false, x: x0, y: Math.max(0, y0 - AIM_DY) };
  const hold = setTimeout(() => { if (_aim && _aim.id === id) { _aim.on = true; drawAim(); } }, 250);
  const done = () => { clearTimeout(hold); removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', cancel, true); };
  const move = (ev) => {
    if (!_aim || ev.pointerId !== id) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (!_aim.on && Math.hypot(x - x0, y - y0) > 10) _aim.on = true;
    _aim.x = x; _aim.y = Math.max(0, y - AIM_DY);
    drawAim();
  };
  const cancel = (ev) => { if (ev.pointerId === id) { done(); _aim = null; drawAim(); } };
  const up = (ev) => {
    if (ev.pointerId !== id) return;
    done();
    ev.stopImmediatePropagation();
    const a = _aim; _aim = null; drawAim();
    if (!a) return;                                        // cancelled by a second finger
    if (a.on) { measureClick(a.x, a.y); return; }          // aimed: exactly under the crosshair
    let x = a.x0, y = a.y0;                                // a tap: under the finger, or the nearest hit within 16 px
    const popts = { pointPx: +$('#ptPx').value, blocksAsPoints: _viewMode === 'points', section: currentSection() };
    if (renderer.pick(x, y, cam, popts) == null) { const nb = nearPick(Math.round(x), Math.round(y), TOUCH_PICK_R, popts); if (nb) { x = nb.x; y = nb.y; } }
    measureClick(x, y);
  };
  addEventListener('pointermove', move, { capture: true, passive: false }); addEventListener('pointerup', up, true); addEventListener('pointercancel', cancel, true);
}
let _lastTap = null;                                       // a finger's last tap (canvas-input: double-tap)

// click vs drag: small movement, short hold — a finger drifts more than a mouse.
// Times are the EVENTS' (e.timeStamp, performance.now()'s clock), not the handler's:
// a pick is synchronous and can take a second on a big model, so the next tap's
// handler runs late — read at handler time, a quick tap looked like a long hold and
// two quick taps never made a double-tap.
let _pdown = null;
cv.addEventListener('pointerdown', (e) => { _pdown = { x: e.clientX, y: e.clientY, t: e.timeStamp, b: e.button, touch: e.pointerType === 'touch' || e.pointerType === 'pen' }; });
cv.addEventListener('pointerup', (e) => {
  const d = _pdown; _pdown = null;
  if (!d || d.b !== 0) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > (d.touch ? 12 : 5) || e.timeStamp - d.t > 500) return;
  const r = cv.getBoundingClientRect();
  let px = e.clientX - r.left, py = e.clientY - r.top;
  const popts = { pointPx: +$('#ptPx').value, blocksAsPoints: _viewMode === 'points', section: currentSection() };
  let hit = renderer.pick(px, py, cam, popts);
  if (hit == null && d.touch) { const nb = nearPick(Math.round(px), Math.round(py), TOUCH_PICK_R, popts); if (nb) { hit = nb.hit; px = nb.x; py = nb.y; } }
  // a finger's DOUBLE tap: on the model, orbit about that spot (the first tap already
  // showed its record); on empty space, fit. Touch only — a mouse keeps its clicks.
  const now = e.timeStamp;
  const dbl = d.touch && _lastTap && now - _lastTap.t < 320 && Math.hypot(e.clientX - _lastTap.x, e.clientY - _lastTap.y) < 30;
  _lastTap = dbl ? null : { t: now, x: e.clientX, y: e.clientY };
  if (dbl) {
    if (hit == null) { $('#btnFit').click(); $('#meta').textContent = 'fit — double-tap the model to orbit about a spot'; }
    else pivotOn(hit, px, py);
    return;
  }
  showPickAt(hit, px, py);
});

// ── the MAGNIFIER (Vogel & Baudisch's Shift): a finger hides what it touches. Hold still
// on the view with no tool armed and a loupe opens ABOVE the finger — what's under it,
// ×2.5, a crosshair on the exact point, the record there lit live; slide to refine (the
// view holds still meanwhile), lift to pick exactly there. The measure crosshair uses the
// same loupe. Touch only. ──
const LOUPE_D = 132, LOUPE_ZOOM = 2.5, LOUPE_HOLD = 350;
let _loupe = null;                                         // { id, x, y, hit } while magnifying
function loupeEl() {
  let el = $('#loupe');
  if (!el) {
    el = document.createElement('div'); el.id = 'loupe'; el.setAttribute('aria-hidden', 'true');
    const c = document.createElement('canvas'); el.appendChild(c);
    document.body.appendChild(el);
  }
  return el;
}
// show the loupe magnifying the canvas around (x, y) (canvas px); `fx, fy` = the finger,
// which it keeps clear of — above, or beside it when there's no room above
function drawLoupe(x, y, fx = x, fy = y) {
  const el = loupeEl(), c = el.firstChild, r = cv.getBoundingClientRect();
  const ratio = cv.width / (cv.clientWidth || 1), dp = Math.round(LOUPE_D * Math.min(2, devicePixelRatio || 1));
  if (c.width !== dp) { c.width = dp; c.height = dp; }
  let cx = r.left + fx, cy = r.top + Math.min(fy, y) - 100 - LOUPE_D / 2 + 30;
  if (cy - LOUPE_D / 2 < 40) { cy = r.top + fy - 40; cx = r.left + fx + (fx < r.width / 2 ? 1 : -1) * (LOUPE_D / 2 + 44); }
  cx = Math.max(LOUPE_D / 2 + 4, Math.min(innerWidth - LOUPE_D / 2 - 4, cx));
  el.style.left = (cx - LOUPE_D / 2) + 'px'; el.style.top = (cy - LOUPE_D / 2) + 'px'; el.style.display = 'block';
  const g = c.getContext('2d'), src = (LOUPE_D / LOUPE_ZOOM) * ratio;
  g.fillStyle = '#121212'; g.fillRect(0, 0, dp, dp);
  g.imageSmoothingEnabled = false;
  try { g.drawImage(cv, x * ratio - src / 2, y * ratio - src / 2, src, src, 0, 0, dp, dp); } catch { /* a lost context */ }
  const m = dp / 2, k = dp / LOUPE_D;
  g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3 * k;
  g.beginPath(); g.moveTo(m - 14 * k, m); g.lineTo(m - 4 * k, m); g.moveTo(m + 4 * k, m); g.lineTo(m + 14 * k, m); g.moveTo(m, m - 14 * k); g.lineTo(m, m - 4 * k); g.moveTo(m, m + 4 * k); g.lineTo(m, m + 14 * k); g.stroke();
  g.strokeStyle = '#f0b44c'; g.lineWidth = 1.5 * k; g.stroke();
}
function hideLoupe() { const el = $('#loupe'); if (el) el.style.display = 'none'; }
const loupeFree = () => !_measure.arm && !_selArm && !PAINT.arm && !_knifeArm;
cv.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !_isMobile() || e.button !== 0 || !loupeFree()) return;
  if (_loupe) { endLoupe(); return; }                      // a second finger: let the pinch have it
  const r = cv.getBoundingClientRect(), id = e.pointerId, x0 = e.clientX, y0 = e.clientY;
  let fingers = 1;
  const arm = { id, x0, y0 };
  const early = (ev) => { if (ev.pointerId === id && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) quit(); };
  const other = (ev) => { if (ev.pointerType === 'touch' && ev.pointerId !== id) { fingers++; quit(); } };
  const quit = () => { clearTimeout(arm.t); removeEventListener('pointermove', early, true); removeEventListener('pointerdown', other, true); removeEventListener('pointerup', quit, true); removeEventListener('pointercancel', quit, true); };
  arm.t = setTimeout(() => {
    quit();
    if (fingers > 1 || !loupeFree()) return;
    _pdown = null;                                         // the lift is the loupe's, not a tap's
    _loupe = { id, x: x0 - r.left, y: y0 - r.top, hit: null, meta: $('#meta').textContent };
    loupeMove({ pointerId: id, clientX: x0, clientY: y0, preventDefault() {}, stopImmediatePropagation() {} });
    addEventListener('pointermove', loupeMove, { capture: true, passive: false });
    addEventListener('pointerup', loupeUp, true); addEventListener('pointercancel', loupeCancel, true);
    $('#meta').textContent = 'magnifier — slide onto the spot, lift to pick it';
  }, LOUPE_HOLD);
  addEventListener('pointermove', early, true); addEventListener('pointerdown', other, true);
  addEventListener('pointerup', quit, true); addEventListener('pointercancel', quit, true);
}, { capture: true });
function loupeMove(e) {
  if (!_loupe || e.pointerId !== _loupe.id) return;
  e.preventDefault(); e.stopImmediatePropagation();       // the view holds still while magnifying
  const r = cv.getBoundingClientRect();
  _loupe.x = Math.max(0, Math.min(r.width - 1, e.clientX - r.left)); _loupe.y = Math.max(0, Math.min(r.height - 1, e.clientY - r.top));
  const popts = { pointPx: +$('#ptPx').value, blocksAsPoints: _viewMode === 'points', section: currentSection() };
  _loupe.hit = renderer.pick(Math.round(_loupe.x), Math.round(_loupe.y), cam, popts);
  renderer.setPicked(_loupe.hit); requestRender();
  requestAnimationFrame(() => { if (_loupe) drawLoupe(_loupe.x, _loupe.y); });   // after the lit record draws
}
function endLoupe() {
  removeEventListener('pointermove', loupeMove, true); removeEventListener('pointerup', loupeUp, true); removeEventListener('pointercancel', loupeCancel, true);
  if (_loupe && $('#meta').textContent.startsWith('magnifier')) $('#meta').textContent = _loupe.meta;   // the hint goes with the loupe
  _loupe = null; hideLoupe();
}
function loupeUp(e) {
  if (!_loupe || e.pointerId !== _loupe.id) return;
  const { x, y, hit } = _loupe;
  endLoupe();                                              // (the up still reaches the orbit control, which lets go)
  showPickAt(hit, x, y);
}
function loupeCancel(e) { if (_loupe && e.pointerId === _loupe.id) { endLoupe(); renderer.setPicked(null); requestRender(); } }
