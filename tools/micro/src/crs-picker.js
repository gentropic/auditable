// micro CRS PICKER — a QGIS-style coordinate-system selector with a map.
//
//   await openCrsPicker({ title, purpose, fits, initial }) → a @gcu/proj CRS object, or null
//
// Search by name words or EPSG code over the FULL EPSG table (every projected + geographic-2D
// system with a proj4 definition — inflated on first open, never fetched); filters: all /
// projected / geographic / recently used / fits my data (the area of use holds the data's lon/lat
// extent); suggestions from where the data sits; a Natural Earth world map drawn on a canvas with
// the selected system's AREA OF USE (accent) and the DATA's extent (violet); the details (name,
// code, kind, units, datum, area, the accuracy of its datum shift, the proj4 definition); and a
// box for a pasted definition (proj4 string, OGC / ESRI WKT, or a code). purpose 'project'
// refuses geographic systems (micro's world is metres).
import { searchCrs, suggestCrs, crsFromDefinition, crsLabel, worldRings, loadEpsgTable, lookupEpsg } from '../../../ext/proj/index.js';
import { floatWin } from './windows.js';
import { recentCrsCodes } from './crs.js';

let _open = null;
export function crsPickerOpen() { return _open; }

export function openCrsPicker({ title = 'coordinate system', purpose = 'any', fits = null, initial = null } = {}) {
  if (_open) _open.close();
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; _open = null; resolve(v); };
    const win = floatWin({ title, sub: 'EPSG · search, filter, or paste a definition', x: Math.max(12, innerWidth / 2 - 380), y: 70, w: 760, h: 600, onClose: () => finish(null) });
    win.el.dataset.crsPicker = '1';
    const st = { q: '', filter: fits ? 'fits' : (purpose === 'project' ? 'projected' : 'all'), sel: initial || null, list: [], suggestions: [] };
    _open = { win, st, close: () => win.close(), pick: (c) => { st.sel = c; render(); }, accept: () => accept() };
    const B = win.body;
    B.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font:12px var(--mono);overflow:hidden';
    const top = el('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap');
    const q = el('input', 'flex:1;min-width:200px'); q.className = 'sw-in'; q.placeholder = 'search: a name (sirgas utm 23s) or a code (31983)'; q.dataset.crsSearch = '1';
    top.append(q);
    const fbtns = {};
    for (const [k, t] of [['all', 'all'], ['projected', 'projected'], ['geographic', 'geographic'], ['recent', 'recent'], ['fits', 'fits my data']]) {
      const b = el('button'); b.className = 'awin-btn'; b.textContent = t; b.dataset.crsFilter = k;
      if (k === 'fits' && !fits) { b.disabled = true; b.title = 'no data extent known yet (open data in a known coordinate system)'; }
      b.onclick = () => { st.filter = k; refresh(); };
      fbtns[k] = b; top.append(b);
    }
    const sugg = el('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-height:0;color:var(--dim);font-size:11px');
    const mid = el('div', 'display:flex;gap:10px;flex:1;min-height:0');
    const listEl = el('div', 'flex:1 1 50%;overflow-y:auto;border:1px solid var(--border);border-radius:3px;min-height:120px'); listEl.dataset.crsList = '1';
    const right = el('div', 'flex:1 1 50%;display:flex;flex-direction:column;gap:6px;min-width:0;overflow-y:auto');
    const cv = el('canvas', 'width:100%;aspect-ratio:2/1;border:1px solid var(--border);border-radius:3px;background:var(--bg-field)'); cv.dataset.crsMap = '1';
    const det = el('div', 'font-size:11px;line-height:1.5;color:var(--text);word-break:break-word'); det.dataset.crsDetails = '1';
    right.append(cv, det);
    mid.append(listEl, right);
    const pasteRow = el('div', 'display:flex;gap:6px;align-items:flex-start');
    const ta = el('textarea', 'flex:1;height:38px;font:11px var(--mono);resize:vertical'); ta.className = 'sw-in'; ta.placeholder = 'or paste a definition: +proj=tmerc +lat_0=0 +lon_0=-44 … · a WKT (a .prj) · EPSG:31983'; ta.dataset.crsPaste = '1';
    const use = el('button'); use.className = 'awin-btn'; use.textContent = 'Read'; use.title = 'read the pasted definition';
    pasteRow.append(ta, use);
    const foot = el('div', 'display:flex;gap:8px;align-items:center');
    const msg = el('span', 'flex:1;color:var(--muted);font-size:11px'); msg.dataset.crsMsg = '1';
    const cancel = el('button'); cancel.className = 'awin-btn'; cancel.textContent = 'Cancel';
    const ok = el('button'); ok.className = 'awin-btn btn-p'; ok.textContent = 'Use this system'; ok.dataset.crsOk = '1';
    foot.append(msg, cancel, ok);
    B.append(top, sugg, mid, pasteRow, foot);
    cancel.onclick = () => { finish(null); win.close(); };
    const accept = () => {
      if (!st.sel) { msg.textContent = 'pick a system first'; return; }
      if (purpose === 'project' && st.sel.kind === 'geographic') { msg.textContent = `${st.sel.name} is geographic (degrees) — a project works in metres: pick a projected system`; return; }
      const c = st.sel; finish(c); win.close();
    };
    ok.onclick = accept;
    use.onclick = async () => {
      try { st.sel = await crsFromDefinition(ta.value); msg.textContent = st.sel.epsg ? `read as ${crsLabel(st.sel)}${st.sel.matchedBy ? ` (by ${st.sel.matchedBy})` : ''}` : 'read a custom definition'; render(); }
      catch (e) { msg.textContent = e.message; }
    };
    let t0 = null;
    q.oninput = () => { clearTimeout(t0); t0 = setTimeout(() => { st.q = q.value; refresh(); }, 120); };
    q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!st.sel && st.list[0]) st.sel = st.list[0]; accept(); } };
    const refresh = async () => {
      for (const [k, b] of Object.entries(fbtns)) b.classList.toggle('btn-p', st.filter === k);
      listEl.textContent = 'loading the EPSG table…';
      await loadEpsgTable();
      const opts = { limit: 300 };
      if (st.filter === 'projected' || st.filter === 'geographic') opts.kind = st.filter;
      if (st.filter === 'fits') opts.fits = fits;
      if (st.filter === 'recent') opts.codes = recentCrsCodes();
      if (purpose === 'project' && st.filter !== 'geographic' && !opts.kind) opts.kind = 'projected';
      st.list = await searchCrs(st.q, opts);
      if (st.filter === 'fits' && !st.q) {                  // fits with no query: the suggestions first
        const s = st.suggestions.map((c) => c.epsg);
        st.list.sort((a, b) => (s.indexOf(b.epsg) >= 0) - (s.indexOf(a.epsg) >= 0) || (s.indexOf(a.epsg) - s.indexOf(b.epsg)));
      }
      renderList();
      render();
    };
    const renderList = () => {
      listEl.textContent = '';
      if (!st.list.length) { listEl.append(el('div', 'padding:8px;color:var(--dim)', st.filter === 'recent' ? 'nothing used yet' : 'no system matches')); return; }
      for (const c of st.list) {
        const r = el('div', 'padding:3px 8px;cursor:pointer;display:flex;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
        r.dataset.code = String(c.epsg);
        const code = el('span', 'color:var(--dim);flex:0 0 64px', String(c.epsg));
        const nm = el('span', 'overflow:hidden;text-overflow:ellipsis', c.name);
        r.append(code, nm);
        r.title = `${crsLabel(c)} — ${c.area}`;
        r.onclick = () => { st.sel = c; render(); };
        r.ondblclick = () => { st.sel = c; accept(); };
        listEl.append(r);
      }
    };
    const render = () => {
      for (const r of listEl.children) if (r.dataset) r.style.background = st.sel && st.sel.epsg && +r.dataset.code === st.sel.epsg ? 'var(--accent-soft)' : '';
      const c = st.sel;
      det.textContent = '';
      if (!c) det.append(el('div', 'color:var(--dim)', 'pick a system — its area of use shows on the map' + (fits ? ', next to your data (violet)' : '')));
      else {
        const row = (k, v) => { const d = el('div'); d.append(el('span', 'color:var(--dim)', k + ' '), el('span', '', v)); det.append(d); };
        row('name', c.name);
        row('code', c.epsg ? `EPSG:${c.epsg}` : 'custom (no code)');
        row('kind', c.kind);
        row('units', c.units || '—');
        row('datum', c.datum || '—');
        if (c.area) row('area of use', c.area);
        if (c.bbox) row('bounds', `${c.bbox[0]}° to ${c.bbox[2]}° E · ${c.bbox[1]}° to ${c.bbox[3]}° N`);
        if (c.accuracy != null) row('datum shift', `~${c.accuracy} m to WGS 84 (EPSG's stated accuracy)`);
        if (/\+nadgrids=(?!@null)/.test(c.def)) row('note', 'its datum shift needs a grid (not bundled) — reprojecting into or out of it is unknown-accuracy unless a published shift stands in');
        const pre = el('div', 'margin-top:4px;padding:4px 6px;background:var(--bg-field);border:1px solid var(--border);border-radius:3px;font-size:10px;max-height:64px;overflow:auto', c.def);
        pre.dataset.crsDef = '1';
        det.append(pre);
        if (fits && c.bbox) {
          const inside = fits[0] >= c.bbox[0] - 1e-9 && fits[2] <= c.bbox[2] + 1e-9 && fits[1] >= c.bbox[1] - 1e-9 && fits[3] <= c.bbox[3] + 1e-9;
          det.append(el('div', `margin-top:4px;color:${inside ? 'var(--go)' : 'var(--caution)'}`, inside ? 'your data sits inside its area of use' : 'your data lies (partly) OUTSIDE its area of use'));
        }
      }
      ok.disabled = !c;
      drawMap();
    };
    const drawMap = async () => {
      const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      const W = Math.max(200, Math.round(r.width * dpr)), H = Math.round(W / 2);
      if (cv.width !== W) { cv.width = W; cv.height = H; }
      const g = cv.getContext('2d');
      const css = getComputedStyle(document.documentElement);
      const col = (v, d) => (css.getPropertyValue(v) || d).trim() || d;
      g.fillStyle = col('--bg-field', '#141414'); g.fillRect(0, 0, W, H);
      const X = (lon) => (lon + 180) / 360 * W, Y = (lat) => (90 - lat) / 180 * H;
      g.strokeStyle = col('--border', '#2a2a2a'); g.lineWidth = 1;
      for (let lon = -180; lon <= 180; lon += 30) { g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), H); g.stroke(); }
      for (let lat = -60; lat <= 60; lat += 30) { g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(W, Y(lat)); g.stroke(); }
      const rings = await worldRings();
      g.fillStyle = col('--bd2', '#444');
      g.beginPath();
      for (const ring of rings) { g.moveTo(X(ring[0]), Y(ring[1])); for (let i = 2; i < ring.length; i += 2) g.lineTo(X(ring[i]), Y(ring[i + 1])); g.closePath(); }
      g.fill('evenodd');
      const box = (b, stroke, fill) => {
        const parts = b[0] <= b[2] ? [[b[0], b[2]]] : [[b[0], 180], [-180, b[2]]];
        for (const [w, e] of parts) {
          const x0 = X(w), x1 = X(e), y0 = Y(b[3]), y1 = Y(b[1]);
          g.fillStyle = fill; g.fillRect(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0));
          g.strokeStyle = stroke; g.lineWidth = 1.5 * dpr; g.strokeRect(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0));
        }
      };
      if (st.sel && st.sel.bbox) box(st.sel.bbox, col('--accent', '#c89b3c'), 'rgba(200,155,60,0.18)');
      if (fits) {
        box(fits, col('--sel', '#9d8ce0'), 'rgba(157,140,224,0.35)');
        const cx = X((fits[0] + fits[2]) / 2), cy = Y((fits[1] + fits[3]) / 2);
        g.strokeStyle = col('--sel', '#9d8ce0'); g.lineWidth = 1.5 * dpr; g.beginPath(); g.arc(cx, cy, 6 * dpr, 0, 2 * Math.PI); g.stroke();
      }
    };
    win.el._onResized = () => drawMap();
    (async () => {
      if (fits) {
        st.suggestions = await suggestCrs(fits, { limit: 5 });
        sugg.textContent = '';
        if (st.suggestions.length) {
          sugg.append(el('span', '', 'suggested from where the data sits:'));
          for (const c of st.suggestions) {
            const b = el('button'); b.className = 'awin-btn'; b.style.fontSize = '11px'; b.textContent = `${c.name} · ${c.epsg}`; b.dataset.crsSuggest = String(c.epsg);
            b.onclick = () => { st.sel = c; render(); };
            sugg.append(b);
          }
          if (!st.sel) st.sel = st.suggestions[0];
        }
      }
      if (st.sel && st.sel.epsg && !st.sel.def) st.sel = await lookupEpsg(st.sel.epsg);
      await refresh();
      q.focus();
    })();
  });
}

function el(tag, css = '', text = null) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
