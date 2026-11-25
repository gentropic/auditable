// micro — SECTIONS: a slab is four floats (normal + offset) + a half-thickness —
// scrubbing re-prefixes and re-converges each step (§2.2: it must feel free).
// plan = horizontal (Z normal); N–S section faces east (X normal); E–W faces
// north (Y normal). The slider spans the document extent along the normal.
// Also the knife (a free vertical cut drawn across the view), follow mode, 2D
// mode, the ⌃/⌥ + wheel scrub, and the section in world terms for the host API.
import { rendererDocBbox } from './layers.js';
import { S, activeDocs, requestRender } from './state.js';
import { _isMobile } from './windows.js';
import { markProjectDirty } from './project.js';
import { PHI_MAX } from './camera.js';
import { unprojectToMidZ } from './pick.js';
const $ = (s) => document.querySelector(s);

const SEC_N = { plan: [0, 0, 1], ns: [1, 0, 0], ew: [0, 1, 0] };

let _knife = null;                                       // { n:[3] } set by the knife tool

function secNormal() {
  const mode = $('#secMode').value;
  if (mode === 'knife') return _knife && _knife.n;
  if (mode === 'custom') {
    // plane by dip direction α + dip δ → the upward-ish pole (δ=0 → plan)
    const a = ((+$('#secDipDir').value || 0) % 360) * Math.PI / 180;
    const d = Math.max(0, Math.min(90, +$('#secDip').value || 0)) * Math.PI / 180;
    return [-Math.sin(a) * Math.sin(d), -Math.cos(a) * Math.sin(d), Math.cos(d)];
  }
  return SEC_N[mode] || null;
}

export function secRange() {
  const n = secNormal(), b = rendererDocBbox();
  if (!n) return null;
  // extent of the local bbox projected on the normal (all 8 corners — n is arbitrary)
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < 8; c++) {
    const d = n[0] * b[(c & 1) ? 3 : 0] + n[1] * b[(c & 2) ? 4 : 1] + n[2] * b[(c & 4) ? 5 : 2];
    if (d < lo) lo = d; if (d > hi) hi = d;
  }
  return [lo, hi];
}

export function currentSection() {
  const mode = $('#secMode').value;
  if (mode === 'off' || !S.renderer.chunkCount) return null;
  const n = secNormal();
  if (!n) return null;                                    // knife armed but no cut drawn yet
  const [lo, hi] = secRange();
  const d0 = lo + (+$('#secPos').value) * (hi - lo);
  const clip = $('#secClip').value;
  if (clip === 'front' || clip === 'behind') {
    // a half-space IS a slab with the far face pushed past the data: keep
    // |dot−(d0±H)| ≤ H ⇒ dot ≥ d0 (front, the normal side) or ≤ d0 (behind).
    // H is big enough to swallow any scene yet small enough that the f32
    // uniform still places the near face exactly at d0.
    const H = Math.max(1e5, 8 * (hi - lo || 1));
    return { on: true, n, d: clip === 'front' ? d0 + H : d0 - H, half: H, d0, clip, traceHalf: Math.max(0.01, +$('#secHalf').value) };   // meshes trace at the TRUE plane, this wide
  }
  return { on: true, n, d: d0, half: Math.max(0.01, +$('#secHalf').value), d0, clip: 'slab' };
}

// The knife cut: two world points → the VERTICAL plane containing the segment.
export function knifeCut(x1, y1, x2, y2) {
  const p1 = unprojectToMidZ(x1, y1), p2 = unprojectToMidZ(x2, y2);
  if (!p1 || !p2) return false;
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const l = Math.hypot(dx, dy);
  if (l < 1) return false;                                // degenerate drag
  const n = [dy / l, -dx / l, 0];                         // horizontal normal ⊥ the drawn line
  _knife = { n };
  const [lo, hi] = secRange();
  const d0 = n[0] * p1[0] + n[1] * p1[1];
  $('#secPos').value = hi > lo ? Math.max(0, Math.min(1, (d0 - lo) / (hi - lo))) : 0.5;
  requestRender();
  return true;
}

// Arming: choosing `knife` turns the next drag into a cut (capture-phase handlers
// pre-empt orbit); the plane then locks until the mode changes or knife is re-picked.
export let _knifeArm = false, _knifeStart = null;

export function armKnife(on) {
  _knifeArm = on;
  S.cv.style.cursor = on ? 'crosshair' : '';
  if (on) $('#meta').textContent = 'knife: drag a line across the model — the vertical section through it · ⇧ snaps to 15° (⇧⌥ 5°)';
}

// ⇧ constrains the drawn line to angle increments (15°; ⇧⌥ → 5°). Screen-space —
// in plan view (where sections are cut) that IS the bearing, so ⇧ gives clean
// N–S / E–W / 15° sections. Alt (not Ctrl) so Mac's ctrl-click-is-right-click
// doesn't abort the drag.
function knifeSnap(sx, sy, ex, ey, e) {
  if (!e.shiftKey) return [ex, ey];
  const step = (e.altKey ? 5 : 15) * Math.PI / 180;
  const ang = Math.round(Math.atan2(ey - sy, ex - sx) / step) * step;
  const len = Math.hypot(ex - sx, ey - sy);
  return [sx + Math.cos(ang) * len, sy + Math.sin(ang) * len];
}

function syncSecUI() {
  const mode = $('#secMode').value;
  const on = mode !== 'off';
  $('#secPos').style.display = on ? '' : 'none';
  $('#secClip').style.display = on ? '' : 'none';
  $('#secHalf').style.display = on && $('#secClip').value === 'slab' ? '' : 'none';
  $('#secPlaneW').style.display = on ? '' : 'none';
  $('#secFollowW').style.display = on ? '' : 'none';
  $('#sec2DW').style.display = on ? '' : 'none';
  if (!on && $('#sec2D').checked) { $('#sec2D').checked = false; $('#sec2D').dispatchEvent(new Event('input')); }   // section off releases the lock
  $('#secDipDir').style.display = mode === 'custom' ? '' : 'none';
  $('#secDip').style.display = mode === 'custom' ? '' : 'none';
  // the phone's strip + ⋯ row mirror the same state
  const clip = $('#secClip').value;
  document.body.classList.toggle('sec-custom', mode === 'custom');
  for (const b of $('#secKeep').children) b.classList.toggle('on', b.dataset.c === clip);
  $('#secThin').disabled = $('#secThick').disabled = clip !== 'slab';
}

function syncSectionBtn() {                                 // the bar button AND the phone's section strip follow every path that changes the section
  const on = $('#secMode').value !== 'off';
  $('#btnSection').classList.toggle('on', on);
  document.body.classList.toggle('sec-on', on && document.body.classList.contains('mobile'));
}

// FOLLOW mode: the camera translates with the scrub (Δd along the plane normal)
// so the cut stays put on screen while the deposit slides through it — walking
// the sections. Applies to user scrubs only (slider events + scrubSection);
// project restore sets secPos SILENTLY, so it can never teleport the camera.
export let _secFollow = (() => { try { return localStorage.getItem('micro.secFollow') === '1'; } catch { return false; } })();

function secFollowShift(dd, n) {
  if (!dd || !n) return;
  const st = S.cam.state;
  st.target = [st.target[0] + dd * n[0], st.target[1] + dd * n[1], st.target[2] + dd * n[2]];
  S.cam.update();
}

// 2D MODE: face the section, go orthographic, lock drag-orbit (drags pan) —
// micro reads like a paper section/plan. Composes with follow = the slicer walk.
// Transient (not persisted): a restored project shouldn't come up rotation-locked.
let _sec2DPrevOrtho = false;

let _secPosPrev = null;                                    // refreshed at gesture start — a silent restore can't leave a stale jump

// the section's controls: the strip / tool-row inputs, the knife's canvas gesture
// (capture phase, before the selection tool's) and the ⌃/⌥ + wheel scrub
export function installSectionTool() {
  S.cv.addEventListener('pointerdown', (e) => {
    if (!_knifeArm || e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    _knifeStart = { x: e.clientX, y: e.clientY };
    $('#knifeSvg').style.display = '';
  }, { capture: true });
  S.cv.addEventListener('pointermove', (e) => {
    if (!_knifeArm || !_knifeStart) return;
    e.stopImmediatePropagation();
    const r = S.cv.getBoundingClientRect(), L = $('#knifeLine');
    const [ex, ey] = knifeSnap(_knifeStart.x, _knifeStart.y, e.clientX, e.clientY, e);
    L.setAttribute('x1', _knifeStart.x - r.left); L.setAttribute('y1', _knifeStart.y - r.top);
    L.setAttribute('x2', ex - r.left); L.setAttribute('y2', ey - r.top);
  }, { capture: true });
  S.cv.addEventListener('pointerup', (e) => {
    if (!_knifeArm || !_knifeStart) return;
    e.stopImmediatePropagation();
    const r = S.cv.getBoundingClientRect(), st = _knifeStart;
    _knifeStart = null;
    $('#knifeSvg').style.display = 'none';
    armKnife(false);
    const [ex, ey] = knifeSnap(st.x, st.y, e.clientX, e.clientY, e);
    if (knifeCut(st.x - r.left, st.y - r.top, ex - r.left, ey - r.top)) {
      $('#meta').textContent = activeDocs().blockDoc ? activeDocs().blockDoc.metaLine : $('#meta').textContent.replace(/^knife:.*/, '');
    } else {
      $('#secMode').value = 'off'; $('#secMode').dispatchEvent(new Event('input'));
    }
  }, { capture: true });
  $('#secMode').addEventListener('input', () => {
    syncSecUI();
    if ($('#secMode').value === 'knife') { _knife = null; armKnife(true); }
    else armKnife(false);
    requestRender();
  });
  $('#secClip').addEventListener('input', () => { syncSecUI(); requestRender(); });
  $('#secDipDir').addEventListener('input', requestRender);
  $('#secDip').addEventListener('input', requestRender);
  $('#secPlaneVis').addEventListener('input', requestRender);
  $('#btnSection').onclick = () => toggleSection();
  $('#btnKnife').onclick = () => { $('#secMode').value = 'knife'; $('#secMode').dispatchEvent(new Event('input')); };   // arm the free-plane cut (same as k / secMode=knife)
  $('#secMode').addEventListener('input', syncSectionBtn);
  $('#secFollow').checked = _secFollow;
  $('#secFollow').addEventListener('input', () => { _secFollow = $('#secFollow').checked; try { localStorage.setItem('micro.secFollow', _secFollow ? '1' : '0'); } catch { /* private */ } });
  $('#sec2D').addEventListener('input', () => {
    const on = $('#sec2D').checked;
    if (on) {
      _sec2DPrevOrtho = !!S.cam.state.ortho;
      viewAlongSection();                                    // face-on (keeps the side you're on)
      S.cam.setOrtho(true);
      S.cam.state.orbitLock = true;
      $('#meta').textContent = '2D — drags pan, view keys still work · uncheck to orbit again';
    } else {
      S.cam.state.orbitLock = false;
      if (!_sec2DPrevOrtho) S.cam.setOrtho(false);             // restore the projection you came from
      $('#meta').textContent = '2D off';
    }
    requestRender();
  });
  for (const ev of ['pointerdown', 'focus']) $('#secPos').addEventListener(ev, () => { _secPosPrev = +$('#secPos').value; });
  $('#secMode').addEventListener('input', () => { _secPosPrev = null; });
  $('#secPos').addEventListener('input', () => {
    const pos = +$('#secPos').value;
    if (_secFollow && _secPosPrev != null) {
      const s = currentSection();
      if (s) { const [lo, hi] = secRange(); if (hi > lo) secFollowShift((pos - _secPosPrev) * (hi - lo), s.n); }
    }
    _secPosPrev = pos;
    requestRender();
  });
  $('#secHalf').addEventListener('input', requestRender);
  for (const id of ['secMode', 'secPos', 'secHalf', 'secClip', 'secDipDir', 'secDip', 'secPlaneVis']) $('#' + id).addEventListener('input', () => dispatchEvent(new Event('micro:project-dirty')));
  window.addEventListener('wheel', (e) => {
    if (e.target !== S.cv || !currentSection()) return;
    // ⌥ + wheel varies slab THICKNESS (proportional per notch → responsive at any
    // scale); a slab only — front/behind half-spaces have no thickness. ⌃/⌘ scrubs.
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if ($('#secClip').value !== 'slab') return;             // half-spaces: nothing to thicken
      e.preventDefault(); e.stopImmediatePropagation();
      _secThickAcc += e.deltaY;
      while (Math.abs(_secThickAcc) >= 100) {
        const up = _secThickAcc < 0;                          // wheel up = thicker
        const cur = Math.max(0.5, +$('#secHalf').value || 5);
        const next = Math.max(0.5, +(cur * (up ? 1.15 : 1 / 1.15)).toPrecision(3));
        $('#secHalf').value = next; $('#secHalf').dispatchEvent(new Event('input'));
        _secThickAcc -= Math.sign(_secThickAcc) * 100;
      }
      $('#meta').textContent = `slab half-thickness ${+$('#secHalf').value} m`;
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    _secWheelAcc += e.deltaY;
    while (Math.abs(_secWheelAcc) >= 100) {
      scrubSection(_secWheelAcc > 0 ? -1 : 1, 0.5);
      _secWheelAcc -= Math.sign(_secWheelAcc) * 100;
    }
  }, { passive: false, capture: true });
}

// at: the plane's WORLD position (n·p, real coordinates). pos (a 0..1 fraction of the data's
// extent along the normal) is kept for older readers, but it moves whenever the set of layers —
// hence the extent — changes, so a bookmark / project / figure / composer frame restores by `at`
// (sweep 2026-11-25: a bookmarked cut at z 600 reopened at ~674 once a taller DEM was added).
export function captureSection() {
  const w = $('#secMode').value !== 'off' ? sectionWorld() : null;
  return { mode: $('#secMode').value, pos: +$('#secPos').value, ...(w ? { at: w.position } : {}), half: +$('#secHalf').value, knifeN: _knife ? _knife.n : null,
           clip: $('#secClip').value, dipDir: +$('#secDipDir').value, dip: +$('#secDip').value, plane: $('#secPlaneVis').checked || undefined };
}

export function applySection(sec) {
  if (!sec) return;
  const sel = $('#secMode');
  $('#secClip').value = ['slab', 'front', 'behind'].includes(sec.clip) ? sec.clip : 'slab';
  if (sec.dipDir != null) $('#secDipDir').value = sec.dipDir;
  if (sec.dip != null) $('#secDip').value = sec.dip;
  $('#secPlaneVis').checked = !!sec.plane;
  if (sec.mode === 'knife' && sec.knifeN) {
    // bypass the input handler (it would re-ARM the knife and wipe the cut)
    _knife = { n: sec.knifeN };
    sel.value = 'knife';
    syncSecUI();
  } else {
    sel.value = sec.mode || 'off';
    sel.dispatchEvent(new Event('input'));
  }
  $('#secPos').value = sec.pos != null ? sec.pos : 0.5;
  // the world plane wins over the fraction when there is one and the data's extent is known
  const n = Number.isFinite(sec.at) && S.renderer.chunkCount ? secNormal() : null;
  const rg = n ? secRange() : null;
  if (rg && rg[1] > rg[0]) {
    const dl = sec.at - dot3(n, S.frame ? S.frame.origin : [0, 0, 0]);
    $('#secPos').value = Math.max(0, Math.min(1, (dl - rg[0]) / (rg[1] - rg[0])));
  }
  $('#secHalf').value = sec.half != null ? sec.half : 10;
  syncSectionBtn(); requestRender();
}

// ── the section in WORLD terms (the host API speaks these). The
// UI keeps a section as a FRACTION of the data's extent along the normal, in
// frame-local coordinates; a host thinks in world coordinates and metres. ──
const SEC_AXIS = { x: 'ns', y: 'ew', z: 'plan' };

export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function sectionWorld() {
  const s = currentSection(); if (!s) return null;
  const mode = $('#secMode').value, n = s.n.slice(), off = dot3(n, S.frame ? S.frame.origin : [0, 0, 0]);
  const axis = Object.keys(SEC_AXIS).find((k) => SEC_AXIS[k] === mode) || null;
  return {
    mode, axis, normal: n,
    position: s.d0 + off,                                  // the plane: n·p = position, world units
    thickness: s.clip === 'slab' ? 2 * s.half : null, clip: s.clip,
    ...(mode === 'custom' ? { dipDir: +$('#secDipDir').value, dip: +$('#secDip').value } : {}),
  };
}

// o: null | { axis: 'x'|'y'|'z' } | { normal: [x,y,z] } | { dipDir, dip }, plus
// { at: [x,y,z] | position: n·p, thickness, clip: 'slab'|'front'|'behind' }.
// Omitted parts keep their current value. Resolves the section as it now stands.
export function setSectionWorld(o) {
  const mode0 = $('#secMode').value;
  if (!o || o.mode === 'off') {
    if (mode0 !== 'off') { $('#secMode').value = 'off'; $('#secMode').dispatchEvent(new Event('input')); }
    return null;
  }
  if (!S.renderer.chunkCount) throw new Error('section: there is nothing to cut yet');
  let mode = null, knifeN = null;
  if (o.axis != null) {
    mode = SEC_AXIS[String(o.axis).toLowerCase()];
    if (!mode) throw new Error(`section: axis is x, y or z (got ${JSON.stringify(o.axis)})`);
  } else if (o.normal != null) {
    const v = [].concat(o.normal).map(Number), l = Math.hypot(...v);
    if (v.length !== 3 || !(l > 0) || v.some((c) => !Number.isFinite(c))) throw new Error('section: normal must be three finite numbers, not all zero');
    const n = v.map((c) => c / l);
    const ax = Object.keys(SEC_N).find((k) => Math.abs(Math.abs(dot3(SEC_N[k], n)) - 1) < 1e-9);
    if (ax && dot3(SEC_N[ax], n) > 0) mode = ax; else { mode = 'knife'; knifeN = n; }
  } else if (o.dipDir != null || o.dip != null) {
    mode = 'custom';
    if (o.dipDir != null) $('#secDipDir').value = ((+o.dipDir % 360) + 360) % 360;
    if (o.dip != null) $('#secDip').value = Math.max(0, Math.min(90, +o.dip));
  } else if (mode0 === 'off') throw new Error('section: say which plane — axis, normal, or dipDir + dip');
  if (o.clip != null) {
    if (!['slab', 'front', 'behind'].includes(o.clip)) throw new Error(`section: clip is slab, front or behind (got ${JSON.stringify(o.clip)})`);
    $('#secClip').value = o.clip;
  }
  if (o.thickness != null) {
    if (!(+o.thickness > 0)) throw new Error('section: thickness must be positive');
    $('#secHalf').value = +o.thickness / 2;
  }
  if (mode === 'knife') { _knife = { n: knifeN }; $('#secMode').value = 'knife'; armKnife(false); syncSecUI(); }   // like applySection: don't re-arm the knife tool
  else if (mode && mode !== mode0) { $('#secMode').value = mode; $('#secMode').dispatchEvent(new Event('input')); }
  else syncSecUI();
  _secPosPrev = null;
  if (o.at != null || o.position != null) {
    const n = secNormal();
    let pw;
    if (o.at != null) { const a = [].concat(o.at).map(Number); if (a.length !== 3 || a.some((c) => !Number.isFinite(c))) throw new Error('section: at must be [x, y, z]'); pw = dot3(n, a); }
    else { pw = +o.position; if (!Number.isFinite(pw)) throw new Error('section: position must be a number'); }
    const [lo, hi] = secRange(), dl = pw - dot3(n, S.frame ? S.frame.origin : [0, 0, 0]);
    $('#secPos').value = hi > lo ? Math.max(0, Math.min(1, (dl - lo) / (hi - lo))) : 0.5;   // clamped to the data
  }
  syncSectionBtn();
  document.body.classList.toggle('sec-on', _isMobile() && $('#secMode').value !== 'off');
  markProjectDirty(); requestRender();
  return sectionWorld();
}

// face-on to the current section: look along the plane normal (minimal turn —
// keep the side we're already on) and pivot the orbit on the section plane.
export function viewAlongSection(back = false) {
  const sec = currentSection(); if (!sec) return;
  const st = S.cam.state, n = sec.n;
  const fwd = [st.target[0] - st.eye[0], st.target[1] - st.eye[1], st.target[2] - st.eye[2]];
  let sign = (fwd[0] * n[0] + fwd[1] * n[1] + fwd[2] * n[2]) >= 0 ? 1 : -1;     // look dir = sign·n
  if (back) sign = -sign;                                                       // ⇧L: face the OTHER side
  const off = [-sign * n[0], -sign * n[1], -sign * n[2]];                        // eye offset = -lookdir
  // re-center the pivot on the plane, then aim
  const dd = st.target[0] * n[0] + st.target[1] * n[1] + st.target[2] * n[2] - sec.d0;
  st.target = [st.target[0] - dd * n[0], st.target[1] - dd * n[1], st.target[2] - dd * n[2]];
  st.theta = Math.atan2(off[1], off[0]);
  st.phi = Math.max(-PHI_MAX, Math.min(PHI_MAX, Math.asin(Math.max(-1, Math.min(1, off[2])))));
  S.cam.update(); requestRender();
}

// section on/off toggle (x): remembers the last mode (knife keeps its cut plane)
let _lastSecMode = 'plan';

export function toggleSection() {
  const sel = $('#secMode');
  if (sel.value === 'off') {
    sel.value = (_lastSecMode === 'knife' && !_knife) ? 'plan' : _lastSecMode;
    // re-entering knife with a stored cut should NOT re-arm drawing — show the cut
    if (sel.value === 'knife' && _knife) {
      syncSecUI();
      syncSectionBtn();
      requestRender();
      return;
    }
  } else {
    _lastSecMode = sel.value;
    sel.value = 'off';
  }
  sel.dispatchEvent(new Event('input'));
}

export function scrubSection(dir, frac = 1) {
  const sec = currentSection(); if (!sec) return;
  const [lo, hi] = secRange();
  if (!(hi > lo)) return;
  const step = (frac * 2 * Math.max(0.01, +$('#secHalf').value)) / (hi - lo);
  const prev = +$('#secPos').value;
  const next = Math.max(0, Math.min(1, prev + dir * step));
  $('#secPos').value = next;
  if (_secFollow) secFollowShift((next - prev) * (hi - lo), sec.n);   // follow: camera walks with the plane
  requestRender();
}

// ⌃/⌘ + wheel scrubs the section — the continuous , / . (the slicer feel).
// Capture-phase on window so it pre-empts the camera dolly AND browser zoom;
// half a slab per notch (finer than the keys), accumulated for trackpads.
let _secWheelAcc = 0, _secThickAcc = 0;
