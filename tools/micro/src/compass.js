// micro compass — the north arrow over the view: click for plan, right-click (or View →
// Compass…) for its corner and size, persisted. Drawn by src/overlay.js. Carved from index.html
// (2026-11-24).
import { PHI_MAX } from './camera.js';
import { menuXY } from './menu.js';
import { setView } from './viewport.js';

const $ = (s) => document.querySelector(s);

$('#compass').addEventListener('click', () => setView(-Math.PI / 2, PHI_MAX));   // plan, north up
$('#compass').addEventListener('pointerdown', (e) => e.stopPropagation());       // don't start an orbit
// corner + size, persisted; the same menu hangs off right-click and View → Compass…
const CMP_SIZES = { small: 54, medium: 74, large: 100 };
let _cmp = (() => { try { return JSON.parse(localStorage.getItem('micro.compass')) || {}; } catch { return {}; } })();
if (!CMP_SIZES[_cmp.size]) _cmp.size = 'medium';
if (!['ne', 'se', 'sw', 'nw'].includes(_cmp.pos)) _cmp.pos = 'se';
function applyCompass() {
  const el = $('#compass');
  el.setAttribute('class', _cmp.pos);
  const px = CMP_SIZES[_cmp.size];
  el.setAttribute('width', px); el.setAttribute('height', px);
  try { localStorage.setItem('micro.compass', JSON.stringify(_cmp)); } catch { /* ignore */ }
}
applyCompass();
export function compassMenu(x, y) {
  const pos = (id, label) => ({ label: (_cmp.pos === id ? '✓ ' : '') + label, action: () => { _cmp.pos = id; applyCompass(); } });
  const size = (id) => ({ label: (_cmp.size === id ? '✓ ' : '') + id[0].toUpperCase() + id.slice(1), action: () => { _cmp.size = id; applyCompass(); } });
  menuXY(x, y, [
    pos('nw', 'North-west'), pos('ne', 'North-east'), pos('sw', 'South-west'), pos('se', 'South-east'),
    { sep: true },
    size('small'), size('medium'), size('large'),
  ]);
}
$('#compass').addEventListener('contextmenu', (e) => { e.preventDefault(); compassMenu(e.clientX, e.clientY); });
