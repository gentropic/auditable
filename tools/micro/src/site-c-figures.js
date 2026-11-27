// Site C's FIGURES — the sample comes with its pages already composed, as a project would:
//   "Site C — geological map"       A3, the plan at 1 : 5 000 (the cover sheet's scale): the rock under the
//                                   regolith, the drill fences, a legend, scale bar, north arrow, title block
//   "Site C — sections A–A′ … C–C′" A4, the three sections across the fold through the drill fences (the
//                                   cover's glass plates) at 1 : 10 000, as vector sections, with a key plan
// Each is an ordinary figure: ↻ refresh, export, other data…, an atlas — all work on it. Made again (replaced
// by name) each time the sample opens; the 3D view is put back as it was.
import { S } from './state.js';
import * as SC from './site-c.js';
import { captureScene, applyScene } from './views.js';
import { setSectionWorld } from './section.js';
import { setCameraWorld } from './viewport.js';
import { openComposer, closeComposer, deleteFigure, addViewFrame, setViewFrame, legendContentFor, addKeyPlan, addTitleBlock, setHouseProps } from './composer.js';

export const SITE_C_FIGURES = { map: 'Site C — geological map', sections: 'Site C — sections A–A′, B–B′, C–C′' };
const D = Math.PI / 180;
// the sections: across the fold (striking 130°), through the three drill fences, 180 m apart along the axis
const FENCES = [['A', -180], ['B', 0], ['C', 180]];

/** the sample's layers: { blocks, drillholes } (drillholes may be null) → the names of the figures made */
export async function buildSiteCFigures({ blocks, drillholes = null }) {
  if (!blocks) return [];
  for (const nm of Object.values(SITE_C_FIGURES)) { const f = S.figures.find((x) => x.name === nm); if (f) await deleteFigure(f, { ask: false }); }
  const O = SC.ORIGIN, B = SC.BOX, C = SC.FRAME.centre, AX = [Math.sin(SC.FRAME.TREND * D), Math.cos(SC.FRAME.TREND * D)];
  setHouseProps({ company: 'Geoscientific Chaos Union', project: 'Site C — an imaginary deposit', ...((S.house && S.house.props) || {}) });
  // a scene: these layers shown, the rest hidden (the topography would veil the rock)
  const scene = async (show) => {
    const sc = captureScene('site-c');
    for (const sl of sc.layers) sl.visible = show.some((L) => L && (sl.name === L.name || sl.name === L.label));
    await applyScene(sc);
  };
  const mine = captureScene('__site-c');
  const made = [];
  try {
    // ── the map: A3 landscape, the ground at 1 : 5 000 ──
    {
      const ed = openComposer(SITE_C_FIGURES.map), doc = ed.getDoc();
      doc.page = { ...doc.page, size: 'A3', orientation: 'landscape', margins: [12, 12, 12, 12] };
      doc.props = { ...(doc.props || {}), drawing: 'SC-01', revision: 'A' };
      const W = 420, m = 12, mw = (B.x1 - B.x0) / 5, mh = (B.y1 - B.y0) / 5;      // mm at 1 : 5 000
      const box = [m + 4, m + 12, +mw.toFixed(1), +mh.toFixed(1)];
      await scene([blocks, drillholes]);
      setSectionWorld(null);
      setCameraWorld({ look: 0, elevation: 90, ortho: true, target: [(B.x0 + B.x1) / 2 + O.E, (B.y0 + B.y1) / 2 + O.N, 300], distance: 2000 });
      const v = addViewFrame(ed, { box, border: true, bg: '#ffffff' });
      if (v) {
        await setViewFrame(ed, v.id, { scaleLock: 5000 });
        ed.addFrame({ kind: 'text', box: [box[0], m, box[2], 10], content: { md: '**Site C — geological map** · the rock under the regolith, the drill fences · 1 : 5 000\nan imaginary deposit; coordinates in an imaginary UTM zone 23S', size: 9 }, source: { app: 'micro', kind: 'site-c-title' } });
        ed.addFrame({ kind: 'scalebar', box: [box[0], box[1] + box[3] + 3, 60, 7], content: { of: v.id } });
        ed.addFrame({ kind: 'north', box: [box[0] + box[2] - 15, box[1] + 2, 13, 17], content: { of: v.id }, style: { background: 'rgba(255,255,255,0.85)' } });
        const lc = legendContentFor(blocks), x = box[0] + box[2] + 8;
        if (lc) ed.addFrame({ kind: 'legend', box: [x, box[1], W - m - x, 7 + 4.4 * (lc.entries ? lc.entries.length + 1 : 8)], content: { ...lc, title: 'Rock' }, source: { app: 'micro', kind: 'legend', layer: blocks.name } });
        ed.addFrame({ kind: 'text', box: [x, box[1] + 60, W - m - x, 60], content: { md: 'A shelf sequence on a gneiss basement, folded into an antiform (axis 040°, plunging 11° NE), cut by a normal fault (strike 120°, dip 65° SW, 70 m throw) and intruded by a granite stock with a skarn against the marble.\n\nGold where the banded iron formation thickens in the fold hinge, and in the skarn. The three drill fences are the sections of the companion sheet.', size: 7 }, source: { app: 'micro', kind: 'site-c-notes' } });
        addTitleBlock(ed);
      }
      ed.render(); made.push(SITE_C_FIGURES.map);
    }
    // ── the sections: A4 portrait, three at 1 : 10 000, looking NE (040°), up the plunge ──
    {
      const ed = openComposer(SITE_C_FIGURES.sections), doc = ed.getDoc();
      doc.page = { ...doc.page, size: 'A4', orientation: 'portrait', margins: [12, 12, 12, 12] };
      doc.props = { ...(doc.props || {}), drawing: 'SC-02', revision: 'A' };
      const m = 12, sw = 128, sh = 58, x0 = m, rx = x0 + sw + 6, rw = 210 - m - rx;   // the section width: 1 280 m
      ed.addFrame({ kind: 'text', box: [x0, m, 210 - 2 * m, 10], content: { md: '**Site C — sections across the fold** · through the three drill fences · 1 : 10 000\nvertical, striking 130°, looking NE (040°); 20 m slabs, the holes in each fence on its section', size: 8 }, source: { app: 'micro', kind: 'site-c-title' } });
      await scene([blocks, drillholes]);
      if (drillholes) S.renderer.setLayerSectioned(drillholes.id, true);   // the sample shows the holes whole; a section shows those in its slab
      const views = [];
      for (let i = 0; i < FENCES.length; i++) {
        const [name, a] = FENCES[i], cx = C.x + AX[0] * a, cy = C.y + AX[1] * a, y = m + 16 + i * (sh + 12);
        setSectionWorld({ dipDir: 40, dip: 90, clip: 'slab', thickness: 20, at: [cx + O.E, cy + O.N, 90] });
        setCameraWorld({ look: 40, elevation: 0, ortho: true, target: [cx + O.E, cy + O.N, 90], distance: 1500 });
        ed.addFrame({ kind: 'text', box: [x0, y, sw, 5], content: { md: `**${name}–${name}′**  ·  NW ${name} … ${name}′ SE`, size: 7.5 }, source: { app: 'micro', kind: 'site-c-caption' } });
        const v = addViewFrame(ed, { box: [x0, y + 6, sw, sh], border: true, bg: '#ffffff' });
        if (!v) continue;
        await setViewFrame(ed, v.id, { scaleLock: 10000, vectorOn: true });
        views.push(v);
      }
      if (views.length) ed.addFrame({ kind: 'scalebar', box: [x0, m + 16 + 3 * (sh + 12) - 4, 50, 7], content: { of: views[0].id } });
      ed.select([]);
      const kp = await addKeyPlan(ed);                       // every section on the page, on the whole model from above
      if (kp) { const [, , w, h] = kp.box, k = Math.min(1, rw / w); ed.update(kp.id, (fr) => { fr.box = [rx, m + 22, +(w * k).toFixed(1), +(h * k).toFixed(1)]; }); }
      const lc = legendContentFor(blocks), ly = m + 22 + (kp ? kp.box[3] + 6 : 0);
      if (lc) ed.addFrame({ kind: 'legend', box: [rx, ly, rw, 7 + 4.4 * (lc.entries ? lc.entries.length + 1 : 8)], content: { ...lc, title: 'Rock' }, source: { app: 'micro', kind: 'legend', layer: blocks.name } });
      addTitleBlock(ed);
      ed.render(); made.push(SITE_C_FIGURES.sections);
    }
  } finally {
    closeComposer();
    await applyScene(mine);
  }
  return made;
}
