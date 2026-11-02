// micro mesh QA — a wireframe's report before it bounds an estimate: watertight
// or not, one shell or several, faces all one way, slivers and duplicates, and the
// volume (× a density, the tonnage) it holds. The checks are @gcu/geometry's
// meshQa over the mesh's own triangles, welded at coincident vertices first (a
// per-face soup shares no edge otherwise). Each issue keeps example locations:
// clicking it steps the camera through them. Self-intersections aren't checked
// yet, and the window says so.
import { meshQa } from '../../../ext/geometry/index.js';
import { meshVertexData } from './records.js';
import { floatWin, focusWindow } from './windows.js';
import { fmtStat, plotExportBtns } from './analysis-ui.js';
import { convert as unitConvert } from '../../../ext/units/index.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setMeshQaHooks): zoomToPoint([x,y,z], radius)
let H = {};
export function setMeshQaHooks(h) { H = h; }
export const _meshQaWins = new Map();

const ISSUES = [
  ['boundary', 'boundary edges (holes — not closed)', 'error'],
  ['nonManifold', 'non-manifold edges (3+ faces)', 'error'],
  ['flipped', 'edges both faces cross the same way (a flipped face)', 'warn'],
  ['degenerate', 'zero-area triangles (slivers)', 'warn'],
  ['duplicate', 'duplicate triangles', 'warn'],
];
const SEV = { error: '#c0584a', warn: '#c8a43c', ok: 'var(--ok)' };

export async function openMeshQa(L) {
  const md = L && L.docs && L.docs.meshDoc;
  if (!md) { $('#meta').textContent = 'mesh QA: needs a mesh layer'; return null; }
  const ex = _meshQaWins.get(L.id); if (ex && ex.win.el.isConnected) { focusWindow(ex.win.el); return ex; }
  const st = { weld: true, density: '', densUnit: 't/m3', r: null, err: null, running: false, step: {} };
  const win = floatWin({ title: `mesh QA · ${L.label || L.name}`, sub: 'checking…', x: Math.max(12, innerWidth - 760), y: 110, w: 720, h: 440,
    onClose: () => { _meshQaWins.delete(L.id); } });
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main st-main';
  body.append(rail, main);
  const sumEl = document.createElement('div'); sumEl.className = 'mq-sum';
  const row = (label, el, title) => { const r = document.createElement('div'); r.className = 'sw-row'; if (title) r.title = title; const s = document.createElement('span'); s.textContent = label; s.style.width = '52px'; r.append(s, el); return r; };
  const dIn = document.createElement('input'); dIn.className = 'sw-in'; dIn.placeholder = 'e.g. 2.7'; dIn.value = st.density;
  dIn.onchange = () => { st.density = dIn.value.trim(); render(); };
  const dU = document.createElement('select'); dU.className = 'sw-sel';
  for (const [v, t] of [['t/m3', 't/m³'], ['kg/m3', 'kg/m³'], ['lb/ft3', 'lb/ft³']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; dU.append(o); }
  dU.onchange = () => { st.densUnit = dU.value; render(); };
  const wl = document.createElement('label'); wl.className = 'sw-row'; wl.title = 'merge vertices at exactly the same coordinates first — a per-face soup shares no edge otherwise';
  const wc = document.createElement('input'); wc.type = 'checkbox'; wc.checked = st.weld; wc.onchange = () => { st.weld = wc.checked; run(); }; wl.append(wc, ' weld coincident vertices');
  const sumH = Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'solid' });
  const optH = Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'options' });
  const foot = document.createElement('div'); foot.className = 'sw-foot';
  rail.append(sumH, sumEl, optH, wl, row('density', dIn, 'tonnage = volume × density (the coordinates\' units, cubed)'), row('ρ unit', dU), foot);

  const fmtV = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e4 ? Math.round(v).toLocaleString() : fmtStat(v));
  const tonnes = (v) => { const d = parseFloat(st.density.replace(',', '.')); return Number.isFinite(d) && v != null ? v * d * unitConvert(1, st.densUnit, 't/m3') : null; };
  const cell = (tr, text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.append(td); return td; };
  function render() {
    sumEl.textContent = ''; main.textContent = '';
    if (st.err) { const d = document.createElement('div'); d.className = 'st-empty'; d.textContent = st.err; main.append(d); win.sub.textContent = 'mesh QA'; return; }
    const r = st.r; if (!r) { const d = document.createElement('div'); d.className = 'st-empty'; d.textContent = 'checking…'; main.append(d); return; }
    const line = (k, v, color) => { const d = document.createElement('div'); d.className = 'sw-row'; const a = document.createElement('span'); a.textContent = k; a.style.width = '80px'; const b = document.createElement('b'); b.textContent = v; if (color) b.style.color = color; d.append(a, b); sumEl.append(d); };
    line('watertight', r.watertight ? '✓ yes' : '✗ no', r.watertight ? SEV.ok : SEV.error);
    line('faces', r.consistent ? '✓ one way' : '✗ mixed', r.consistent ? SEV.ok : SEV.warn);
    line('shells', String(r.shells.length));
    line('volume', r.volume == null ? '— (not closed)' : fmtV(r.volume), r.volume != null && r.volume < 0 ? SEV.warn : null);
    const t = tonnes(r.volume); if (t != null) line('tonnes', fmtV(t));
    line('area', fmtV(r.area));
    line('triangles', r.triangles.toLocaleString());
    if (r.welded || r.collapsed) line('welded', `${r.welded.toLocaleString()} vertices${r.collapsed ? ` · ${r.collapsed} triangles collapsed` : ''}`);
    // issues: click a row to step through its locations
    const it = document.createElement('table'); it.className = 'st-tbl mq-tbl';
    const hr = document.createElement('tr'); for (const h of ['', 'issue', 'count', 'go to']) { const th = document.createElement('th'); th.textContent = h; hr.append(th); } it.append(hr);
    let any = false;
    for (const [k, label, sev] of ISSUES) {
      const s = r.issues[k]; if (!s.count) continue; any = true;
      const tr = document.createElement('tr'); tr.title = 'click: the camera goes to the next one';
      const dot = cell(tr, '●'); dot.style.color = SEV[sev];
      cell(tr, label); cell(tr, s.count.toLocaleString(), 'num');
      const at = cell(tr, s.at.length ? `1 / ${s.at.length}${s.count > s.at.length ? '+' : ''}` : '');
      tr.onclick = () => { const i = st.step[k] = ((st.step[k] ?? -1) + 1) % s.at.length; H.zoomToPoint(s.at[i], 0); at.textContent = `${i + 1} / ${s.at.length}${s.count > s.at.length ? '+' : ''}`; };
      it.append(tr);
    }
    if (!any) { const d = document.createElement('div'); d.className = 'qa-clean'; d.textContent = '✓ no topology issues'; main.append(d); } else main.append(it);
    // shells
    const ht = Object.assign(document.createElement('div'), { className: 'sw-h mq-h', textContent: 'shells' }); main.append(ht);
    const tb = document.createElement('table'); tb.className = 'st-tbl mq-tbl';
    const h2 = document.createElement('tr'); for (const h of ['#', 'triangles', 'closed', 'volume', ...(tonnes(1) != null ? ['tonnes'] : []), 'area', 'size (x × y × z)']) { const th = document.createElement('th'); th.textContent = h; h2.append(th); } tb.append(h2);
    r.shells.slice(0, 500).forEach((s, i) => {
      const tr = document.createElement('tr'); tr.title = 'click: go to this shell';
      cell(tr, String(i + 1)); cell(tr, s.triangles.toLocaleString(), 'num'); cell(tr, s.closed ? '✓' : '✗');
      cell(tr, fmtV(s.volume), 'num'); if (tonnes(1) != null) cell(tr, fmtV(tonnes(s.volume)), 'num'); cell(tr, fmtV(s.area), 'num');
      cell(tr, [0, 1, 2].map((k) => fmtStat(s.bbox[k + 3] - s.bbox[k])).join(' × '));
      tr.onclick = () => H.zoomToPoint([0, 1, 2].map((k) => (s.bbox[k] + s.bbox[k + 3]) / 2), Math.hypot(s.bbox[3] - s.bbox[0], s.bbox[4] - s.bbox[1], s.bbox[5] - s.bbox[2]) / 2);
      tb.append(tr);
    });
    main.append(tb);
    const note = document.createElement('div'); note.className = 'mq-note';
    note.textContent = `volume and area in the coordinates' units (cubed / squared); a void wound inward counts negative; self-intersections are not checked yet${r.shells.length > 500 ? ` · first 500 of ${r.shells.length} shells listed` : ''}`;
    main.append(note);
    win.sub.textContent = `${r.watertight ? 'watertight' : 'not watertight'} · ${r.shells.length} shell${r.shells.length === 1 ? '' : 's'}${r.volume != null ? ` · volume ${fmtV(r.volume)}` : ''}`;
    win.el._meshQa = r;
  }
  const tableTSV = () => {
    const r = st.r; if (!r) return null;
    const lines = ['shell\ttriangles\tclosed\tvolume\ttonnes\tarea\tx min\ty min\tz min\tx max\ty max\tz max'];
    r.shells.forEach((s, i) => lines.push([i + 1, s.triangles, s.closed ? 'yes' : 'no', s.volume ?? '', tonnes(s.volume) ?? '', s.area, ...s.bbox].join('\t')));
    return lines.join('\n');
  };
  foot.append(plotExportBtns(null, () => `meshqa-${(L.label || L.name).replace(/\.[^.]+$/, '')}`, tableTSV, 'mesh-qa'));
  async function run() {
    if (st.running) return;
    st.running = true; st.err = null; st.step = {};
    win.sub.textContent = 'checking…'; win.sub.classList.add('busy');
    await new Promise((z) => setTimeout(z));
    try {
      const m = await meshVertexData(L);
      if (!m) throw new Error('this mesh is drawn streamed (no triangles kept on the page) — “Convert to exact” first');
      st.r = meshQa(m.vertices, m.triangles, { weld: st.weld });
    } catch (e) { st.err = `mesh QA: ${e.message || e}`; st.r = null; }
    finally { st.running = false; win.sub.classList.remove('busy'); }
    render();
  }
  const handle = { win, st, run, tableTSV };
  _meshQaWins.set(L.id, handle);
  render();
  await run();
  return handle;
}
