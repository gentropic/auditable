// wuffle desk — figures: compo's editor in a tab, over a page made from a diagram — a net, a rose or a fabric plot
// (figure.js). The host buttons: "+ diagram" (another diagram's frames on this page), "↻ from the diagrams" (every
// frame again from its diagram as it is now, layout kept), Export PDF (vectors — the net, the rose and the fabric
// plot are frames drawn from data, not pictures) and Export PNG. A frame whose diagram has changed says "older
// data"; a net frame has its own projection / hemisphere / graticule / selection in the inspector. Figures are
// kept in the project.

import * as bearing from '../../../ext/bearing/index.js';
import { mountEditor, registerKind, exportPDF, exportPNG, exportSVG, setQrEncoder } from '../../../ext/compo/index.js';
import { Menu } from '../../../ext/menu/index.js';
import { toMatrix as qrMatrix } from '../../../ext/qr/index.js';
setQrEncoder(qrMatrix);                                   // a figure's QR frames
import { stereonetCore } from '../../../ext/stereonet/index.js';
import { buildFigure, refreshFigure, diagramFrames, staleOf } from './figure.js';
import { roseKind, fabricKind } from './figure-kinds.js';
import { sceneLayers } from './layers.js';
import { formatPlane, formatLine } from '../../../ext/stereonet/index.js';

registerKind('stereonet', stereonetCore(bearing).compoKind());
registerKind('rose', roseKind(bearing.rose));
registerKind('fabric', fabricKind());

const download = (blob, name) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
const fileName = (s) => String(s || 'figure').replace(/[^\w.-]+/g, '_');

export function createFigures({ project: p, layout, onStatus = () => {} }) {
  const editors = new Map();   // figureId → compo editor
  const tabId = (id) => 'fig:' + id;
  // "older data" badges: the diagrams' contents, computed once per change of the project (a badge is asked for on
  // every redraw of the page)
  let staleCache = new Map();
  p.on((e) => { if (!/^figure/.test(e.type)) staleCache = new Map(); });
  // a net frame's own view, in the inspector: projection, hemisphere, graticule, selection — kept in source.view
  // (so ↻ keeps them) and applied at once
  const VIEW_OPTS = { projection: [['', 'as the diagram'], ['equal-area', 'equal-area (Schmidt)'], ['equal-angle', 'equal-angle (Wulff)']],
    hemisphere: [['', 'as the diagram'], ['lower', 'lower'], ['upper', 'upper']], graticule: [['', 'as the diagram'], ['0', 'none'], ['5', '5°'], ['10', '10°'], ['15', '15°'], ['30', '30°']] };
  function netInspector(frame, panel, ed) {
    const s = frame.source || {}; if (frame.kind !== 'stereonet' || !s.wuffle || !p.diagram(s.diagram)) return;
    const view = { ...(s.view || {}) };   // (graticule 0 = none: kept, it isn't 'as the diagram')
    const row = (label, el) => { const r = document.createElement('div'); r.className = 'row'; const a = document.createElement('span'); a.textContent = label; const b = document.createElement('span'); b.className = 'ctl'; b.append(el); r.append(a, b); panel.append(r); };
    const apply = () => {                                  // one undo step: the setting and the net it makes
      const doc = JSON.parse(JSON.stringify(ed.getDoc())), fx = doc.frames.find((x) => x.id === frame.id); if (!fx) return;
      const v2 = Object.fromEntries(Object.entries(view).filter(([, v]) => v !== '' && v != null && v !== false));
      fx.source = { ...fx.source, view: v2 }; if (!Object.keys(v2).length) delete fx.source.view;
      const mine = refreshFigure(p, { ...doc, frames: [fx] }).frames[0];
      ed.update(frame.id, (fr) => { fr.source = mine.source; fr.content = mine.content; });
    };
    const h = document.createElement('div'); h.textContent = 'this net'; h.style.cssText = 'font-weight:bold;margin-top:8px'; panel.append(h);
    for (const [k, opts] of Object.entries(VIEW_OPTS)) {
      const sel = document.createElement('select'); for (const [v, t] of opts) sel.append(new Option(t, v)); sel.value = view[k] != null ? String(view[k]) : '';
      sel.onchange = () => { view[k] = k === 'graticule' && sel.value ? +sel.value : sel.value; apply(); };
      row(k, sel);
    }
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!view.selection; cb.title = 'print the selected measurements, in violet';
    cb.onchange = () => { view.selection = cb.checked; apply(); };
    row('selection', cb);
  }

  layout.registerPanel('fig:', {
    render(tab) {
      const f = p.figure(tab.figureId), host = document.createElement('div'); host.className = 'wfig-host';
      if (!f) return host;
      const ed = mountEditor(host, f.doc, {
        onChange: (doc) => p.setFigureDoc(f.id, doc),
        onStatus,
        // Add label on a net: pinned to the selected datum (its pole or line), reading its attitude; with nothing
        // selected compo pins it to the net's centre — no data point needed, drag the box where it should read
        labelPoint: (v) => {
          if (v.kind !== 'stereonet') return null;
          const dId = (v.source && v.source.diagram) || f.from;
          for (const L of (p.diagram(dId) ? sceneLayers(p, dId) : [])) {
            if (!L.selected || !L.selected.length) continue;
            const d = L.data.find((o) => o.row === L.selected[0]); if (!d) continue;
            if (d.pole) return { at: d.pole, text: formatPlane(d.plane) };
            if (d.dcos) return { at: d.dcos, text: formatLine(d.line) };
          }
          return null;
        },
        frameBadge: (fr) => staleOf(p, fr, staleCache),
        inspector: (fr, panel, ed2) => netInspector(fr, panel, ed2),
        toolbar: [
          { label: '+ diagram', title: 'another diagram on this page — its frames land in free space', run: async (e) => {
            const r = e.el ? e.el.getBoundingClientRect() : { left: 200, top: 120 };
            const a = await Menu.show(p.diagrams.length ? p.diagrams.map((g) => ({ label: `${g.name} (${g.kind})`, action: g.id })) : [{ label: 'no diagrams', disabled: true }], { x: r.left + 260, y: r.top + 40 });
            if (!a) return;
            const fs = diagramFrames(p, e.getDoc(), a); for (const fr of fs) e.addFrame(fr);
            p.setFigureDoc(f.id, e.getDoc()); onStatus(fs.crowded ? `${p.diagram(a).name} added — the page had no room left, so its frames sit on top: move or shrink them (or make room first)` : `${p.diagram(a).name} added to the page`);
          } },
          { label: '↻ from the diagrams', title: 'make every diagram, legend, statistics and caption frame again from its diagram as it is now (your layout and your edits stay)', run: (e) => {
            const ids = [...new Set(e.getDoc().frames.map((x) => x.source && x.source.diagram).filter(Boolean))];
            const gone = ids.filter((id) => !p.diagram(id));
            e.setDoc(refreshFigure(p, e.getDoc())); p.setFigureDoc(f.id, e.getDoc());
            onStatus(`figure made again from ${ids.length - gone.length} diagram${ids.length - gone.length === 1 ? '' : 's'}${gone.length ? ` — ${gone.length} gone (their frames kept as they were)` : ''}`);
          } },
          { label: 'Export PDF', title: 'a vector PDF of the page', run: async (e) => { download(new Blob([await exportPDF(e.getDoc(), { title: f.name, creator: 'wuffle' })], { type: 'application/pdf' }), `${fileName(f.name)}.pdf`); } },
          { label: 'Export PNG', title: 'the page as a picture', run: async (e) => { download(await exportPNG(e.getDoc(), { dpi: 200 }), `${fileName(f.name)}.png`); } },
          { label: 'Export SVG', title: 'the page as SVG: vectors to edit in Inkscape or Illustrator', run: async (e) => { download(new Blob([await exportSVG(e.getDoc())], { type: 'image/svg+xml' }), `${fileName(f.name)}.svg`); } },
        ],
      });
      editors.set(f.id, ed);
      return host;
    },
    destroy(tab) { editors.get(tab.figureId)?.destroy(); editors.delete(tab.figureId); },
  });

  /** a figure of the active net (or the one given) → its id; opens its tab */
  function newFigure(diagramId = p.activeDiagram) {
    const g = p.diagram(diagramId); if (!g) throw new Error('no diagram');
    const id = p.addFigure({ name: `${g.name} · figure`, doc: buildFigure(p, diagramId), from: diagramId });
    open(id);
    return id;
  }
  function open(id) {
    const f = p.figure(id); if (!f) return;
    if (!layout.hasTab(tabId(id))) layout.addTab({ id: tabId(id), title: f.name, closeable: true, figureId: id });
    layout.rails.activateTab(tabId(id));
  }
  p.on((e) => {
    if (['figure-removed', 'project-loaded', 'history'].includes(e.type)) for (const id of [...editors.keys()]) if (!p.figure(id)) layout.closeTab(tabId(id));
    if (e.type === 'history') for (const [id, ed] of editors) { const f = p.figure(id); if (f && JSON.stringify(f.doc) !== JSON.stringify(ed.getDoc())) ed.setDoc(f.doc); }   // an undone figure edit shows
  });
  /** every figure as ONE PDF: a page each, in the project's order, figure numbers running on, a footer naming the
   *  project and the page. → bytes (and downloads them) */
  async function exportBook({ download: dl = true } = {}) {
    if (!p.figures.length) throw new Error('no figures yet — Figure ▸ New figure from the active diagram');
    const docs = p.figures.map((f) => (editors.get(f.id) ? editors.get(f.id).getDoc() : f.doc));
    const bytes = await exportPDF(docs, { title: p.name || 'wuffle figures', creator: 'wuffle', source: false,
      running: { footer: `${(p.name || 'wuffle').replace(/[{}]/g, '')} · page {page} of {pages}` } });
    if (dl) download(new Blob([bytes], { type: 'application/pdf' }), `${fileName(p.name || 'figures')}-figures.pdf`);
    onStatus(`${docs.length} figure${docs.length === 1 ? '' : 's'} in one PDF`);
    return bytes;
  }
  return { newFigure, open, editors, exportBook };
}
