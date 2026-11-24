// micro — after a SLOW open of a block model (a big .dm or CSV), a one-line OFFER to
// store it as spatial Parquet: one conversion, then fast reopens and spatial pushdown.
// An offer, never automatic; a "not for this file" (or the ×) is remembered per file
// (name + size), so a model opened every morning asks once.
import { layerById } from './state.js';
import { openOptimizeDialog } from './optimize.js';
import { convertLayerToParquet } from './export.js';
import { t } from './i18n.js';

const SLOW_MS = 8000;
const keyOf = (L) => { const d = L.docs.blockDoc; return `micro.pqOffer:${d.name || L.name}:${d.blob && d.blob.size}`; };
const remembered = (L) => { try { return localStorage.getItem(keyOf(L)) === 'no'; } catch { return false; } };
const remember = (L) => { try { localStorage.setItem(keyOf(L), 'no'); } catch { /* private mode: asks again next time */ } };

// the layer's open took `ms`: offer when it's slow, a stored block model not yet Parquet,
// not a view, and not declined for this file. → the bar, or null.
export function maybeOfferParquet(lid, ms) {
  const L = layerById(lid);
  const d = L && L.docs && L.docs.blockDoc;
  const slow = window.__pqOfferMs != null ? window.__pqOfferMs : SLOW_MS;   // smoke hook: the threshold
  if (!d || d.parquet || L.viewOf != null || !(ms > slow) || !d.blob || remembered(L)) return null;
  document.querySelectorAll('.pq-offer').forEach((e) => e.remove());   // one at a time: the latest open's
  const bar = document.createElement('div');
  bar.className = 'pq-offer';
  bar.setAttribute('role', 'status');
  const msg = document.createElement('span');
  msg.textContent = t('Opened in {s} s — store it as Parquet for fast reopens?', { s: (ms / 1000).toFixed(0) });
  const yes = document.createElement('button'); yes.textContent = t('Store as Parquet…');
  const no = document.createElement('button'); no.textContent = t('not for this file');
  const x = document.createElement('button'); x.textContent = '×'; x.title = t('dismiss'); x.className = 'pq-x';
  const close = () => bar.remove();
  yes.onclick = async () => {
    close();
    const L2 = layerById(lid); if (!L2) return;
    const res = await openOptimizeDialog([L2]);
    if (res && res.layers.length) await convertLayerToParquet(L2, { keepOriginal: res.keepOriginal });
  };
  no.onclick = () => { remember(L); close(); };
  x.onclick = () => { remember(L); close(); };
  bar.append(msg, yes, no, x);
  (document.querySelector('#view') || document.body).appendChild(bar);
  // gone when its layer is (closed, replaced)
  const gone = () => { if (!layerById(lid)) { close(); removeEventListener('micro:project-dirty', gone); } };
  addEventListener('micro:project-dirty', gone);
  return bar;
}
