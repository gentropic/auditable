// scenes for Installing and running, When something looks wrong, and Keys and mouse (fork T)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VP = { width: 1180, height: 760 };

export const SCENES = {
  // ch. trouble — a file whose columns wuffle had to guess: the table's heading says how it read them
  'it-guess': {
    viewport: VP,
    async stage({ ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk;
        await W.files.open([new File(['azimuth,inclination\n120,40\n128,44\n300,62\n296,58\n'], 'joints.csv')]);
        await new Promise((r) => setTimeout(r, 300));
        W.table.show?.(W.project.datasets[0].id);
        W.rails.activateTab('table');
      });
      await wait(300);
      return { el: '.wt-host', wait: 500 };
    },
  },

  // ch. trouble — what the net couldn't draw, said in its corner: two contoured layers of one dataset
  'it-note': {
    viewport: { width: 720, height: 520 },   // a smaller net, so the corner note prints at a readable size
    async stage({ p, ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk, P = W.project;
        W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
        const g = P.diagrams[0].id, ds = P.datasets[0].id;
        P.renameDataset(ds, 'joints');
        const b = P.addLayer(g, ds, { name: 'joints, again' });
        P.setElement(P.layers[0].id, 'contours', true); P.setElement(b, 'contours', true);
      });
      await wait(400); await p.mouse.move(5, 5);
      return { el: '.wn-host', wait: 500 };
    },
  },

  // ch. trouble — the console's `>` trap, and the quoted form that works
  'it-redirect': {
    viewport: { width: 680, height: 640 },   // a narrow console: its text fills the frame
    async stage({ ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk;
        W.menus.run('console'); await new Promise((r) => setTimeout(r, 300));
        for (const l of ['sample tocher', 'cd /home', 'select cone 150>60 10', 'ls', 'rm 60', "select cone '207>01' 20", 'cd /project']) await W.console.run(l);
      });
      return { el: '.wcon', wait: 700 };
    },
  },
};
