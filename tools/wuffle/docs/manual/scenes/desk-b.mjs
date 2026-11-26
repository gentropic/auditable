// scenes for selections, statistics, roses and fabric plots, rotation (ch. 10–13)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VP = { width: 1180, height: 760 };

// open Tocher and run console lines (each through the shell, so a typed selection draws its shape)
async function setup(ev, lines, after) {
  await ev(async ([lines, after]) => {
    const W = window.__wuffleDesk;
    W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
    for (const l of lines) await W.console.run(l);
    if (after === 'stats') W.rails.activateTab('stats');
    else if (after === 'table') W.rails.activateTab('table');
    await new Promise((r) => setTimeout(r, 300));
  }, [lines, after]);
}
// split Tocher into two "limbs" by dip direction, both drawn on the active net
async function limbs(ev) {
  await ev(() => {
    const P = window.__wuffleDesk.project, t = P.datasets[0];
    P.select(t.id, t.rows.map((_, i) => i).filter((i) => +t.rows[i]['dip direction'] < 180)); const a = P.selectionToDataset(t.id, 'east');
    P.select(t.id, t.rows.map((_, i) => i).filter((i) => +t.rows[i]['dip direction'] >= 180)); const b = P.selectionToDataset(t.id, 'west');
    P.clearSelection();
    P.setLayerStyle(P.addLayer(P.activeDiagram, a), { color: '#3a7bd5' });
    P.setLayerStyle(P.addLayer(P.activeDiagram, b), { color: '#2f9e57' });
    P.setLayerVisible(P.layers[0].id, false);
  });
}

export const SCENES = {
  // ch. 10 — a cone typed in the console: the dashed outline, the selection violet, the table brushed
  'select-cone': {
    viewport: VP,
    async stage({ ev }) { await setup(ev, ['select cone 040/50 20'], 'table'); return { el: '.wn-stage svg', wait: 700 }; },
  },
  // ch. 10 — the band tool chosen (its width field shows), a band added to a cone
  'select-band': {
    viewport: VP,
    async stage({ p, ev }) {
      await setup(ev, ['select cone 040/50 20', 'select + band 040/50 10'], 'table');
      await p.click('.wsel-bar button[data-tool=band]');
      return { els: ['.wsel-bar', '.wn-stage svg'], wait: 600 };   // the tool strip (with the band's width field) and the net
    },
  },
  // ch. 11 — the statistics card for Tocher
  'stats-card': {
    viewport: VP,
    async stage({ ev }) {
      await setup(ev, [], 'stats');
      // the panel sits in a short stack under the nets; lift it out so the whole card (and its buttons) shows
      await ev(() => { const el = document.querySelector('.wst-panel'); Object.assign(el.style, { position: 'fixed', inset: '0', zIndex: 9999, overflow: 'visible', padding: '16px', background: getComputedStyle(document.body).backgroundColor, width: '620px', height: 'auto' }); });
      return { el: '.wst-card', wait: 500 };
    },
  },
  // ch. 11 — the mean (with its cone) and the eigenvectors drawn on the net
  'derived-net': {
    viewport: VP,
    async stage({ ev }) {
      await setup(ev, ['contour kamb 3', 'show mean', 'eigen'], 'table');
      await ev(() => { const P = window.__wuffleDesk.project, L = P.layers.at(-1);
        P.setLayerStyle(L.id, { color: '#1f5fa8', size: 8 }); });
      return { el: '.wn-stage svg', wait: 700 };
    },
  },
  // ch. 11 — two limbs and the line where their mean planes meet
  'intersect': {
    viewport: VP,
    async stage({ ev }) {
      await setup(ev, [], 'stats');
      await limbs(ev);
      await ev(async () => { const W = window.__wuffleDesk, P = W.project; for (const l of ['show mean east', 'show mean west', 'intersect east west']) await W.console.run(l);
        const L = P.layers.at(-1); P.setLayerStyle(L.id, { color: '#793A8D', size: 9 }); });
      return { el: '.wn-stage svg', wait: 700 };   // the cards are in the text as a table
    },
  },
  // ch. 12 — a rose of Tocher's strikes
  'rose-strike': {
    viewport: VP,
    async stage({ ev }) { await setup(ev, ['new rose'], null); return { el: '.wdg-plain', wait: 700 }; },
  },
  // ch. 12 — a Vollmer fabric plot: Tocher and its two limbs
  'fabric-vollmer': {
    viewport: { width: 760, height: 560 },   // a smaller plot, so its 10 px labels print larger relative to it
    async stage({ ev }) {
      await setup(ev, [], null);
      await limbs(ev);
      await ev(async () => { const W = window.__wuffleDesk, P = W.project; P.setLayerVisible(P.layers[0].id, true); await W.console.run('new fabric'); });
      return { el: '.wdg-paper', wait: 700 };
    },
  },
  // ch. 13 — the net centred on 120→40, contoured, with the same cone as figure 10.1
  'rotated-net': {
    viewport: VP,
    async stage({ ev }) { await setup(ev, ['contour kamb 3', 'rotate 120→40', 'select cone 040/50 20'], 'table'); return { el: '.wn-stage svg', wait: 700 }; },
  },
};
