// How to stage each screenshot in a live wuffle. A scene gets { p, ev } (the Playwright page and
// page.evaluate) in a FRESH page, and returns { el?, wait? }: el = a selector to capture instead of the
// whole window. `query` picks the home (?desk by default), `viewport` the window size.

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

export const SCENES = {
  // ch. 2 — the desk with the Tocher sample, contoured, one pole selected
  'desk-tour': {
    viewport: { width: 1180, height: 760 },   // smaller than a monitor, so the UI's text reads on the page
    async stage({ p, ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk, P = W.project;
        W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
        const L = P.layers[0]; P.setElement(L.id, 'contours', true);
        P.select(L.datasetId, [12]);
        W.menus.run('console'); await new Promise((r) => setTimeout(r, 200));
        W.rails.activateTab('diag:' + P.diagrams[0].id);
      });
      await settle(600);
      await p.mouse.move(5, 5);
      return { wait: 800 };
    },
  },

  // ch. 4 — the console after a few commands
  'console': {
    viewport: { width: 1180, height: 760 },
    async stage({ p, ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk;
        W.menus.run('console'); await new Promise((r) => setTimeout(r, 300));
        for (const line of ['sample tocher', 'contour kamb 3', 'select cone 040/50 20', 'stats']) await W.console.run(line);
      });
      return { wait: 900 };
    },
  },

  // ch. 3 — the compass on a phone-sized window, three typed measurements
  'field-net': {
    query: '?field',
    viewport: { width: 412, height: 860 },
    async stage({ p }) {
      for (const m of ['120/45', '118/47', '200>20']) { await p.fill('#manual', m); await p.press('#manual', 'Enter'); }
      return { wait: 600 };
    },
  },
};
