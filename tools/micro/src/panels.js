// micro side panels — the layers / properties / record panels' widths (drag the inner edge;
// a machine preference) and their buttons. Carved from index.html (2026-11-24).
import { activeLayer } from './state.js';
import { closeProps, setAutoApply, _autoApply, pushAllStyle, syncPPFooter, revertStyle } from './props.js';
import { markProjectDirty } from './project.js';
import { closeLayersPanel } from './layers-panel.js';
import { installRecordPanel } from './pick.js';

const $ = (s) => document.querySelector(s);

// panel widths: drag the inner edge; machine prefs (localStorage), CSS vars so
// the compass dodge tracks live
{
  const saved = (() => { try { return JSON.parse(localStorage.getItem('micro.panels')) || {}; } catch { return {}; } })();
  const setW = (which, px) => {
    px = Math.max(160, Math.min(520, px));
    document.documentElement.style.setProperty(which === 'lp' ? '--lpw' : which === 'pp' ? '--ppw' : '--recw', px + 'px');
    saved[which] = px;
    try { localStorage.setItem('micro.panels', JSON.stringify(saved)); } catch { /* ignore */ }
  };
  if (saved.lp) setW('lp', saved.lp);
  if (saved.rec) setW('rec', saved.rec);
  const grab = (el, which, fromRight) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const move = (ev) => setW(which, fromRight ? innerWidth - ev.clientX : ev.clientX);
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
  };
  grab($('#lpGrab'), 'lp', false);
  grab($('#rpGrab'), 'rec', true);
  grab($('#ppGrab'), 'pp', true);
  if (saved.pp) setW('pp', saved.pp);
}

$('#lpClose').onclick = closeLayersPanel;

$('#ppClose').onclick = closeProps;

$('#ppAuto').onchange = () => {
  setAutoApply($('#ppAuto').checked);
  const L = activeLayer();
  if (_autoApply && L && L._stagePend) pushAllStyle(L);    // least surprise: pending lands
  syncPPFooter();
};
$('#ppApply').onclick = () => { const L = activeLayer(); if (L) { pushAllStyle(L); markProjectDirty(); } };
$('#ppRevert').onclick = () => { const L = activeLayer(); if (L) revertStyle(L); };

installRecordPanel();
