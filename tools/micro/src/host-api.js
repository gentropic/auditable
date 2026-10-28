// micro — the HOST API (window.micro). A page that embeds micro drives it through
// this, and only this, surface: small, versioned, documented (manual appendix D).
//
// window._micro stays what it grew into — the smokes' reach into ~300 internals,
// unstable by definition. Two hosts came to depend on it, and a host that vendors
// micro at a commit breaks silently when one of those internals is renamed. Here:
//   · version: additive changes within a major; a break is a new major;
//   · ids everywhere, plain data out — a host never holds a live internal object;
//   · every verb names its layer — nothing hangs on which layer is "active";
//   · actions return promises that reject with the reason; getters are sync;
//   · a stale id is followed forward when a re-read replaced its layer
//     (micro:layer-replaced { from, to } tells the host too).
// It is a thin layer over the functions the UI itself calls (injected — they live
// in the app module), so the API and the UI can't drift apart.

import { S, layerById } from './state.js';
import { attrColumnsOf, fetchLayerRow, attrRowCountOf } from './records.js';

export const API_VERSION = 1;

const VIEWS = ['north', 'south', 'east', 'west', 'plan', 'below'];

export function createHostApi(d) {
  const live = (id) => {
    const L = layerById(d.followLayer(id));
    if (!L) throw new Error(`micro: no layer ${JSON.stringify(id)}`);
    return L;
  };
  const kindOf = (L) => {
    if (L.dh) return 'drillholes';
    if (L.trace) return 'traces';
    if (L.kind === 'mesh') return L.gridSurface ? 'surface' : 'mesh';
    if (L.kind === 'table') return 'table';
    if (L.docs.gridDoc) return 'grid';
    if (L.docs.blockDoc) return L.docs.blockDoc.header.grid ? 'blocks' : 'points';
    return 'points';
  };
  const bare = (n) => String(n).replace(/^(✎|%|ƒ) /, '');
  const info = (L) => ({
    id: L.id,
    name: L.label || L.name,
    file: L.name,
    kind: kindOf(L),
    count: attrRowCountOf(L),
    columns: (attrColumnsOf(L) || []).map((c) => bare(c.name)),
    colorBy: d.colorByName(L),
    colorChoices: d.colorChoices(L),
    visible: L.visible !== false,
    group: d.groupPathOf(L.id),
  });
  const chrome = () => ({
    title: !document.body.classList.contains('chrome-notitle'),
    badge: !document.body.classList.contains('chrome-nobadge'),
  });
  // async verbs: a synchronous throw becomes a rejection, like every other failure
  const verb = (fn) => async (...a) => fn(...a);

  let ready;
  const readyP = new Promise((res) => { ready = res; });

  const api = {
    version: API_VERSION,
    ready: readyP,

    // ── layers ──
    layers: () => S.layers.map(info),
    layer: (id) => { const L = layerById(d.followLayer(id)); return L ? info(L) : null; },
    addLayer: verb((spec) => d.addLayer(spec)),
    // a file opened as micro opens a dropped one (sniffed, its own dialogs for a
    // detected rotation unless acceptLattice says). A File, Blob or handle.
    open: verb((file, o = {}) => d.openFile(file, o)),
    removeLayer: verb((id) => { d.removeLayer(live(id).id); }),
    setVisible: verb((id, on) => { const L = live(id); L.visible = !!on; d.treeChanged(); }),
    setActive: verb((id) => { d.setActiveLayer(live(id).id); }),
    columns: (id) => info(live(id)).columns,
    row: verb(async (id, rec) => {
      const L = live(id), n = attrRowCountOf(L);
      if (!Number.isInteger(rec) || rec < 0 || (n && rec >= n)) throw new Error(`micro: rec ${rec} is not a record of “${L.label || L.name}”`);
      const vals = await fetchLayerRow(L, rec);
      if (!vals) return null;
      const names = (attrColumnsOf(L) || []).map((c) => bare(c.name)), out = {};
      for (let i = 0; i < names.length && i < vals.length; i++) out[names[i]] = vals[i];
      return out;
    }),

    // ── colour and filter ──
    // column: a column name, or 'elev' | 'solid' | 'rules' (blocks, drillholes),
    // 'elevation' | 'intensity' | 'classification' | 'rgb' (LAS/PLY points).
    // Resolves to the layer's id, which a drillhole re-read changes.
    setColorBy: verb((id, column) => { const L = live(id); return d.setLayerColorBy(L, d.colorSelFor(L, column)); }),
    // the expression language of micro's filter box; '' clears. Any layer — the
    // box shows the active layer's filter, so it mirrors this only for that one.
    filter: verb(async (id, expr) => {
      const L = live(id), e = String(expr == null ? '' : expr);
      if (L.id === S.activeId) d.mirrorFilterBox(e);
      await d.applyBlockFilter(e, L);
    }),
    clearFilter: verb((id) => api.filter(id, '')),

    // ── picking (micro:pick tells the host what the USER picked) ──
    pick: verb(({ layer, rec, frame = false } = {}) => d.pickRecord({ layer: d.followLayer(layer), rec, frame })),
    clearPick: verb(() => d.clearPick()),

    // ── selection (the user's rectangle / lasso / through, or the host's), by
    // record index. micro:selection { layer, count } fires when it changes. ──
    selection: (id) => { const L = live(id), records = d.selectionRecords(L); return { layer: L.id, count: records.length, records }; },
    select: verb((id, records, { mode = 'replace' } = {}) => d.setSelectionRecords(live(id), records == null ? [] : Array.from(records), mode)),
    clearSelection: verb((id) => { if (id == null) d.clearSelection(); else d.setSelectionRecords(live(id), [], 'replace'); }),

    // ── the section, in world terms ──
    // section() → null (off) | { mode, axis, normal, position (n·p, world), thickness, clip, dipDir?, dip? }
    // setSection({ axis | normal | dipDir+dip, at: [x,y,z] | position, thickness, clip }) — null turns it off
    section: () => d.sectionWorld(),
    setSection: verb((o) => d.setSectionWorld(o)),

    // ── view ──
    // view() → { target: [x,y,z] world, look (bearing looked toward, °), elevation (°, 90 = plan), distance, ortho, zExag }
    view: () => d.cameraWorld(),
    setView: verb((v) => d.setCameraWorld(v || {})),
    // a figure of the current view as a PNG Blob, rendered to convergence, with
    // micro's decorations (scale bar, north arrow, legends, title) unless decorations: false
    snapshot: verb(({ scale = 1, decorations = true } = {}) => new Promise((res, rej) => {
      const c = d.renderFigure(scale, { decorations });
      c.toBlob((b) => (b ? res(b) : rej(new Error('micro: snapshot failed'))), 'image/png');
    })),
    fit: verb((id) => { d.fit(id == null ? null : live(id)); }),
    look: verb((view) => {
      if (!VIEWS.includes(view)) throw new Error(`micro: look() takes ${VIEWS.join(' | ')} (got ${JSON.stringify(view)})`);
      d.look(view);
    }),

    // ── groups, by path ("Model/Domains"). A group exists while it holds layers:
    // group(path, ids) creates it; addLayer({ group }) files a new layer in it. ──
    groups: () => d.groupsList(),
    group: verb((path, ids) => {
      if (!String(path || '').trim()) throw new Error('micro: group() needs a path');
      const live2 = [].concat(ids == null ? [] : ids).map((i) => live(i).id);
      if (!live2.length) throw new Error('micro: group() needs at least one layer (an empty group dissolves)');
      d.fileLayersInGroup(path, live2);
    }),
    ungroup: verb((path) => { if (!d.ungroupAt(path)) throw new Error(`micro: no group “${path}”`); }),
    setGroupVisible: verb((path, on) => { if (!d.setGroupVisible(path, on)) throw new Error(`micro: no group “${path}”`); }),

    // ── chrome: the title and the Sealed badge (?embed=1 hides both) ──
    chrome,
    setChrome: (o = {}) => {
      if (o.title != null) document.body.classList.toggle('chrome-notitle', !o.title);
      if (o.badge != null) document.body.classList.toggle('chrome-nobadge', !o.badge);
      return chrome();
    },
  };

  // the app calls this once it is up: the promise resolves, and `micro:ready` fires
  // on micro's window AND on the host's <iframe> element (same-origin), so a host
  // can listen before micro's window exists: iframe.addEventListener('micro:ready', …)
  const announce = () => {
    ready(api);
    dispatchEvent(new CustomEvent('micro:ready', { detail: { version: API_VERSION } }));
    try { if (window.frameElement) window.frameElement.dispatchEvent(new CustomEvent('micro:ready', { detail: { version: API_VERSION } })); } catch { /* cross-origin host */ }
  };
  return { api, announce };
}
