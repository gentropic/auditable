// @gcu/condenser anywidget — the in-view toolbar.
//
// Scope rule: a notebook widget must not become micro. What earns a button is
// what is AWKWARD OR IMPOSSIBLE from Python — mouse-driven geometry (the knife),
// things you need while looking (the pick readout, the legend), and the camera
// moves you would otherwise fiddle with by hand. Everything a line of Python
// does well (ramps, clips, thresholds) stays in Python.
//
// Nothing here is decorative: no external CSS, no icon font, inline SVG only,
// and every control round-trips through the model traits so the notebook sees
// what you did — toggling a layer here really does set `w["topo"].visible`.

const ICON = {
  fit: 'M2 5V2h3M12 5V2H9M2 9v3h3M12 9v3H9',
  view: 'M1 7s2.2-3.9 6-3.9S13 7 13 7s-2.2 3.9-6 3.9S1 7 1 7z M7 8.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z',
  ortho: 'M2.5 3.5h9v7h-9z M2.5 3.5 5 1.5h9v7l-2.5 2',
  pick: 'M3 1.5 11 7l-3.4.7L9 11.8l-1.6.7-1.4-4L3 11z',
  knife: 'M1.5 12.5 8 6l4.5-4.5L11 7l-6 6z M8 6l3 3',
  rect: 'M2 2.5h3M9 2.5h3M11.5 5v3M11.5 9v0M2 11.5h3M9 11.5h3M2.5 5v3M2.5 9v.5',
  lasso: 'M7 2c3 0 5.5 1.7 5.5 3.9S10 9.8 7 9.8 1.5 8.1 1.5 5.9 4 2 7 2z M4.6 9.3c-.5 1.2-.2 2.4.9 3',
  measure: 'M1.5 8.5 8.5 1.5l4 4-7 7z M4 6l1.5 1.5M6.5 3.5 8 5',
  through: 'M2.5 4h5v6h-5z M7.5 7h4M9.5 5.2 11.8 7 9.5 8.8',
  layers: 'M7 1.5 12.5 4.6 7 7.7 1.5 4.6z M1.5 7.4 7 10.5l5.5-3.1M1.5 10.2 7 13.3l5.5-3.1',
  camera: 'M1.5 4.5h2.5l1-1.5h4l1 1.5h2.5v7h-11z M7 9.8a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  close: 'M3.5 3.5l7 7M10.5 3.5l-7 7',
  lock: 'M3.5 6.5h7v6h-7z M5 6.5V4.6a2 2 0 0 1 4 0v1.9',
};

const svg = (d) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
  stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

// colours and fonts come from the theme, as CSS variables the view sets on its host
const CSS = `
.cdt { display:flex; gap:2px; background:var(--cd-panel); border:1px solid var(--cd-border); border-radius:4px; padding:2px;
  font:var(--cd-fs) var(--cd-mono); backdrop-filter:blur(3px); }
.cdt button { all:unset; box-sizing:border-box; width:24px; height:22px; display:grid; place-items:center;
  color:var(--cd-muted); border-radius:3px; cursor:pointer; }
.cdt button:hover { background:var(--cd-hover); color:var(--cd-fg); }
.cdt button:focus-visible { outline:2px solid var(--cd-accent); outline-offset:1px; }
.cdt button[aria-pressed="true"] { background:var(--cd-accent); color:var(--cd-on-accent); }
.cdt .sep { width:1px; background:var(--cd-border); margin:2px 1px; }
.cdpop { position:absolute; left:6px; top:34px; z-index:5; min-width:172px; max-height:220px; overflow:auto;
  background:var(--cd-panel); border:1px solid var(--cd-border); border-radius:4px; padding:5px 6px;
  font:var(--cd-fs) var(--cd-mono); color:var(--cd-fg); backdrop-filter:blur(6px); }
.cdpop h4 { margin:0 0 5px; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--cd-muted); font-weight:600; }
.cdpop label { display:flex; align-items:center; gap:6px; padding:2px 0; cursor:pointer; }
.cdpop input[type=checkbox] { accent-color:var(--cd-accent); margin:0; }
.cdpop .k { color:var(--cd-muted); }
.cdpop .row { display:flex; justify-content:space-between; gap:8px; padding:1px 0; }
.cdpop button.opt { all:unset; display:block; padding:3px 5px; border-radius:3px; cursor:pointer; color:var(--cd-fg); }
.cdpop button.opt:hover { background:var(--cd-hover); }
.cdsec { display:flex; align-items:center; gap:6px;
  background:var(--cd-panel); border:1px solid var(--cd-border); border-radius:4px; padding:3px 7px;
  font:var(--cd-fs) var(--cd-mono); color:var(--cd-fg); backdrop-filter:blur(3px); user-select:none; }
/* FIXED width. The readout is the only elastic thing in this bar, and it sits
   BEFORE the slider — letting it resize as the number changes (N 300 -> N -28.03)
   walks the slider out from under the cursor mid-drag. Monospace + a fixed ch
   box keeps the thumb exactly where the hand left it. */
.cdsec .lbl { flex:0 0 12ch; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  font-variant-numeric:tabular-nums; }
.cdsec input[type=range] { flex:0 0 130px; width:130px; accent-color:var(--cd-accent); }
.cdsec input[type=number] { width:48px; background:var(--cd-bg); color:var(--cd-fg); border:1px solid var(--cd-border);
  border-radius:2px; font:inherit; padding:1px 3px; }
.cdsec button { all:unset; cursor:pointer; color:var(--cd-muted); padding:0 2px; }
.cdsec button:hover { color:var(--cd-accent); }
.cdpick, .cdread { max-width:230px; background:var(--cd-panel); border:1px solid var(--cd-border); border-radius:4px; padding:5px 7px;
  font:var(--cd-fs) var(--cd-mono); color:var(--cd-fg); backdrop-filter:blur(3px); }
.cdread { padding:2px 7px; white-space:pre; font-variant-numeric:tabular-nums; max-width:none; }
.cdpick .t { color:var(--cd-accent); margin-bottom:2px; }
.cdpick .row { display:flex; justify-content:space-between; gap:10px; }
.cdpick .k { color:var(--cd-muted); }
.cdstatus { font:var(--cd-fs) var(--cd-mono); color:var(--cd-muted); text-shadow:0 1px 2px var(--cd-halo); pointer-events:none; }
.cdknife { position:absolute; inset:0; z-index:2; pointer-events:none; }
`;

const fmt = (v) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a >= 1e5 || (a < 0.01 && a > 0) ? v.toExponential(2) : String(Math.round(v * 100) / 100);
};

/**
 * createToolbar(host, api) — api is the widget's own surface:
 *   layers()      → [{ name, kind, visible, hasValue, range, ramp }]
 *   setStyle(i,p) → patch a layer's style (round-trips to Python)
 *   fit(), setView(name), toggleOrtho() → bool, isOrtho()
 *   getSection() / setSection(s) / sectionRange() → [lo, hi] along the normal
 *   knife(x1,y1,x2,y2) → set a section from a screen-space drag
 *   selectRect / selectLasso → region selection (rows go back to Python)
 *   measure → two-click distance / bearing / plunge
 *   snapshot()
 *   onToolChange(tool)
 */
export function createToolbar(host, api) {
  const style = document.createElement('style');
  style.textContent = CSS;
  host.appendChild(style);

  const bar = document.createElement('div');            // placed by the view's chrome slots, like secBar and pickBox
  bar.className = 'cdt';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '3D view tools');

  let pop = null, tool = 'orbit';
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };
  const mkPop = () => { closePop(); pop = document.createElement('div'); pop.className = 'cdpop'; host.appendChild(pop); return pop; };

  const btn = (icon, title, onClick, toggles) => {
    const b = document.createElement('button');
    b.innerHTML = svg(ICON[icon]);
    b.title = title;
    b.setAttribute('aria-label', title);
    if (toggles) b.setAttribute('aria-pressed', 'false');
    b.onclick = (e) => { e.stopPropagation(); onClick(b); };
    bar.appendChild(b);
    return b;
  };
  const sep = () => { const s = document.createElement('div'); s.className = 'sep'; bar.appendChild(s); };

  // ── camera ──
  btn('fit', 'Fit the view to the data', () => { closePop(); api.fit(); });

  const viewBtn = btn('view', 'Standard views', () => {
    if (pop && pop.dataset.k === 'view') return closePop();
    const p = mkPop(); p.dataset.k = 'view';
    p.innerHTML = '<h4>view</h4>';
    for (const [k, label] of [['plan', 'Plan (down)'], ['north', 'Looking north'], ['east', 'Looking east'], ['iso', 'Isometric (looking NE)'], ['three-quarter', 'Three-quarter (looking NE)']]) {
      const b = document.createElement('button');
      b.className = 'opt'; b.textContent = label;
      b.onclick = () => { api.setView(k); closePop(); };
      p.appendChild(b);
    }
    const r = viewBtn.getBoundingClientRect(), h = host.getBoundingClientRect();
    p.style.left = `${r.left - h.left}px`;
  });

  const orthoBtn = btn('ortho', 'Parallel projection (for sections)', (b) => {
    closePop();
    const on = api.toggleOrtho();
    b.setAttribute('aria-pressed', String(on));
  }, true);

  // the orientation lock: pressed = locked (orthographic, drag pans). Hidden when the
  // page locked the view for good (lock_toggle: false) — and so are the views and the
  // projection, which would turn it.
  const lockBtn = btn('lock', 'Lock the orientation (L): drag pans, nothing turns', () => { closePop(); api.toggleLock(); }, true);

  sep();

  // ── tools ──
  const TOOLS = {};
  const setTool = (t) => {
    tool = tool === t ? 'orbit' : t;
    for (const [k, b] of Object.entries(TOOLS)) b.setAttribute('aria-pressed', String(tool === k));
    api.onToolChange(tool);
  };
  const pickBtn = btn('pick', 'Pick: click an element to inspect it', () => { closePop(); setTool('pick'); }, true);
  const rectBtn = btn('rect', 'Rectangle select: drag a box (shift adds)', () => { closePop(); setTool('rect'); }, true);
  const lassoBtn = btn('lasso', 'Lasso select: draw around elements (shift adds)', () => { closePop(); setTool('lasso'); }, true);
  const throughBtn = btn('through', 'Select through: catch everything in the swept volume, not just the visible surface', (b) => {
    closePop();
    const on = api.toggleThrough();
    b.setAttribute('aria-pressed', String(on));
  }, true);
  const measureBtn = btn('measure', 'Measure: click two elements for distance, bearing and plunge', () => { closePop(); setTool('measure'); }, true);
  const knifeBtn = btn('knife', 'Knife: drag a line to cut a section along it', () => { closePop(); setTool('knife'); }, true);
  pickBtn.setAttribute('aria-pressed', 'true');            // picking is the default posture
  tool = 'pick';

  Object.assign(TOOLS, { pick: pickBtn, rect: rectBtn, lasso: lassoBtn, measure: measureBtn, knife: knifeBtn });

  sep();

  // ── layers ──
  const layersBtn = btn('layers', 'Layers', () => {
    if (pop && pop.dataset.k === 'layers') return closePop();
    const p = mkPop(); p.dataset.k = 'layers';
    p.innerHTML = '<h4>layers</h4>';
    api.layers().forEach((L, i) => {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = L.visible !== false;
      cb.onchange = () => api.setStyle(i, { visible: cb.checked });
      const nm = document.createElement('span');
      nm.textContent = L.name;
      const kd = document.createElement('span');
      kd.className = 'k'; kd.style.marginLeft = 'auto';
      kd.textContent = L.kind === 'drillholes' ? 'holes' : L.kind;
      lab.append(cb, nm, kd);
      p.appendChild(lab);
    });
    const r = layersBtn.getBoundingClientRect(), h = host.getBoundingClientRect();
    p.style.left = `${Math.max(4, r.left - h.left - 60)}px`;
  });

  btn('camera', 'Save a PNG of the view', () => { closePop(); api.snapshot(); });

  host.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !bar.contains(e.target)) closePop(); }, true);

  // ── the section bar (only while a section exists) ──
  const secBar = document.createElement('div');
  secBar.className = 'cdsec';
  secBar.style.display = 'none';
  const secLabel = document.createElement('span');
  secLabel.className = 'lbl';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '500';
  const thick = document.createElement('input');
  thick.type = 'number'; thick.min = '0.1'; thick.step = '1';
  thick.title = 'Section thickness';
  slider.setAttribute('aria-label', 'Section position');
  const clearBtn = document.createElement('button');
  clearBtn.innerHTML = svg(ICON.close); clearBtn.title = 'Clear the section';
  secBar.append(secLabel, slider, thick, clearBtn);

  let range = [0, 1];
  slider.oninput = () => {
    const s = api.getSection(); if (!s) return;
    const t = +slider.value / 1000;
    api.setSection({ ...s, position: range[0] + t * (range[1] - range[0]) });
  };
  thick.onchange = () => {
    const s = api.getSection(); if (!s) return;
    api.setSection({ ...s, thickness: Math.max(0.1, +thick.value || 10) });
  };
  clearBtn.onclick = () => api.setSection(null);

  // ── the pick readout ──
  const pickBox = document.createElement('div');
  pickBox.className = 'cdpick';
  pickBox.style.display = 'none';

  // ── the knife rubber band ──
  const NS = 'http://www.w3.org/2000/svg';
  const bandEl = document.createElementNS(NS, 'svg');
  bandEl.setAttribute('class', 'cdknife');
  bandEl.setAttribute('width', '100%');                    // an SVG with no size
  bandEl.setAttribute('height', '100%');                   // gets a 300x150 box and CLIPS the line
  const line = document.createElementNS(NS, 'line');
  const rect = document.createElementNS(NS, 'rect');
  const poly = document.createElementNS(NS, 'polyline');
  const meas = document.createElementNS(NS, 'line');
  for (const el of [line, rect, poly, meas]) {
    el.setAttribute('stroke', 'var(--cd-accent)');
    el.setAttribute('stroke-width', '1.6');
    el.setAttribute('fill', 'none');
  }
  line.setAttribute('stroke-dasharray', '6 4');
  rect.setAttribute('stroke-dasharray', '5 3');
  meas.setAttribute('stroke', 'var(--cd-fg)');
  meas.setAttribute('stroke-dasharray', '4 3');
  const capA = document.createElementNS(NS, 'circle');
  const capB = document.createElementNS(NS, 'circle');
  for (const c of [capA, capB]) { c.setAttribute('r', '3'); c.setAttribute('fill', 'var(--cd-accent)'); }
  bandEl.append(rect, poly, line, meas, capA, capB);
  const hideAll = () => { for (const el of [line, rect, poly, meas, capA, capB]) el.setAttribute('visibility', 'hidden'); };
  hideAll();
  bandEl.style.display = 'none';
  host.appendChild(bandEl);

  return {
    // the elements the view's chrome plugins place: 'toolbar', 'section', 'pick'
    els: { bar, secBar, pickBox },
    get tool() { return tool; },
    // one band, four shapes: 'line' (knife) · 'rect' · 'poly' (lasso) ·
    // 'measure'. Passing nothing clears it.
    setBand(kind, a, b) {
      hideAll();
      if (!kind) { bandEl.style.display = 'none'; return; }
      bandEl.style.display = '';
      if (kind === 'rect') {
        rect.setAttribute('x', Math.min(a[0], b[0])); rect.setAttribute('y', Math.min(a[1], b[1]));
        rect.setAttribute('width', Math.abs(b[0] - a[0])); rect.setAttribute('height', Math.abs(b[1] - a[1]));
        rect.setAttribute('visibility', 'visible');
        return;
      }
      if (kind === 'poly') {
        poly.setAttribute('points', a.map((p) => `${p[0]},${p[1]}`).join(' '));
        poly.setAttribute('visibility', 'visible');
        return;
      }
      const el = kind === 'measure' ? meas : line;
      el.setAttribute('x1', a[0]); el.setAttribute('y1', a[1]);
      el.setAttribute('x2', b[0]); el.setAttribute('y2', b[1]);
      el.setAttribute('visibility', 'visible');
      for (const [c, p] of [[capA, a], [capB, b]]) {
        c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]);
        c.setAttribute('fill', kind === 'measure' ? 'var(--cd-fg)' : 'var(--cd-accent)');
        c.setAttribute('visibility', 'visible');
      }
    },
    clearTool() {
      tool = 'pick';
      for (const [k, b] of Object.entries(TOOLS)) b.setAttribute('aria-pressed', String(k === 'pick'));
      api.onToolChange(tool);
    },
    // pick info → the readout (null hides it)
    showPick(info) {
      if (!info) { pickBox.style.display = 'none'; return; }
      const rows = info.rows.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span>${v}</span></div>`).join('');
      pickBox.innerHTML = `<div class="t">${info.title}</div>${rows}`;
      pickBox.style.display = '';
    },
    // section state → the scrub bar
    syncSection(sec, extent) {
      if (!sec) { secBar.style.display = 'none'; return; }
      range = extent || [0, 1];
      secBar.style.display = '';
      const axis = sec.axis ? sec.axis.toUpperCase() : 'N';
      secLabel.textContent = `${axis} ${fmt(sec.position)}`;
      const span = range[1] - range[0] || 1;
      slider.value = String(Math.round(((sec.position - range[0]) / span) * 1000));
      if (document.activeElement !== thick) thick.value = String(sec.thickness);
    },
    syncOrtho(on) { orthoBtn.setAttribute('aria-pressed', String(!!on)); },
    syncLock(locked, canToggle) {
      lockBtn.setAttribute('aria-pressed', String(!!locked));
      lockBtn.style.display = canToggle ? '' : 'none';
      const fixed = locked && !canToggle;
      viewBtn.style.display = orthoBtn.style.display = fixed ? 'none' : '';
      orthoBtn.style.opacity = locked ? '.45' : '';
      orthoBtn.title = locked ? 'Parallel projection (a locked view always is)' : 'Parallel projection (for sections)';
    },
    syncThrough(on) { throughBtn.setAttribute('aria-pressed', String(!!on)); },
    closePop,
    destroy() { closePop(); [style, bar, secBar, pickBox, bandEl].forEach((n) => n.remove()); },
  };
}
