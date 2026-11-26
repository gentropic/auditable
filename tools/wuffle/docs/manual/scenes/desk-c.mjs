// scenes for the faults and figures chapters (ch. faults, figures)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the try-it's fault file: twelve normal faults round the compass, one with an unknown sense
const FAULTS = ['dip direction,dip,trend,plunge,sense',
  '000,60,000,60,normal', '030,60,030,60,normal', '060,60,060,60,normal', '090,55,090,55,normal', '120,60,120,60,normal',
  '150,65,150,65,normal', '180,60,180,60,normal', '210,60,210,60,normal', '240,50,240,50,normal', '270,60,270,60,normal',
  '300,60,300,60,normal', '330,60,330,60,?'].join('\n');

async function openFaults(ev, extra = []) {
  await ev(async ({ csv, extra }) => {
    const W = window.__wuffleDesk, P = W.project;
    W.addData(csv, 'faults.csv'); await new Promise((r) => setTimeout(r, 400));
    const L = P.layersOf(P.activeDiagram)[0];
    for (const e of extra) P.setElement(L.id, e, true);
    W.rails.activateTab('diag:' + P.activeDiagram);
  }, { csv: FAULTS, extra });
  await wait(500);
}

export const SCENES = {
  // the fault net: great circles, slip arrows (Angelier), P and T axes
  'faults-net': {
    viewport: { width: 1180, height: 760 },
    async stage({ p, ev }) { await openFaults(ev, ['ptAxes']); await p.mouse.move(5, 5); return { el: '.wn-stage svg', wait: 600 }; },   // the net alone, square
  },
  // the right dihedra drawn over the slip lines
  'faults-dihedra': {
    viewport: { width: 1180, height: 760 },
    async stage({ p, ev }) { await openFaults(ev, ['dihedra']); await p.mouse.move(5, 5); return { el: '.wn-stage svg', wait: 800 }; },
  },
  // the statistics card of a fault layer: mean, eigen, σ1 σ2 σ3 and φ
  'faults-stats': {
    viewport: { width: 1180, height: 760 },
    async stage({ ev }) {
      await openFaults(ev);
      await ev(async () => { window.__wuffleDesk.rails.activateTab('stats'); });
      // lift the panel out of its short stack (as stats-card does) so the card shows whole, with no clipped bar under it
      await ev(() => { const el = document.querySelector('.wst-panel'); Object.assign(el.style, { position: 'fixed', inset: '0', zIndex: 9999, overflow: 'visible', padding: '16px', background: getComputedStyle(document.body).backgroundColor, width: '620px', height: 'auto' }); });
      return { el: '.wst-card', wait: 500 };
    },
  },
  // a figure made from a contoured Tocher net, in compo's editor
  'figure-editor': {
    viewport: { width: 1280, height: 820 },
    async stage({ p, ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk, P = W.project;
        W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
        const L = P.layers[0]; P.setElement(L.id, 'contours', true); P.setElement(L.id, 'mean', true);
        await new Promise((r) => setTimeout(r, 200));
        W.menus.run('figure'); await new Promise((r) => setTimeout(r, 1000));
      });
      await p.mouse.move(5, 5);
      return { wait: 900 };
    },
  },
};
