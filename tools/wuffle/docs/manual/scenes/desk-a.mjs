// scenes for the desk part, ch. 7–9 (data, diagrams and layers, what a layer draws)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VP = { width: 1180, height: 760 };

// a small file with a bit of everything: a comment, a quoted field, an unreadable row
const MESSY = '# joints, outcrop 14\ndd,dip,set,note\n120,40,J1,"open, iron-stained"\n128,44,J1,\n300,62,J2,\n310,abc,J2,smudged\n296,58,J2,\n';

export const SCENES = {
  // ch. 7 — the table: a file with an unreadable row (— in the attitude column) and a selected row
  'data-table': {
    viewport: VP,
    async stage({ ev }) {
      await ev(async (text) => {
        const W = window.__wuffleDesk, P = W.project;
        const id = W.files.addData(text, 'outcrop-14.csv'); await new Promise((r) => setTimeout(r, 200));
        W.rails.activateTab('table'); W.table.show(id); P.select(id, [2]);
      }, MESSY);
      await wait(500);
      return { wait: 600 };
    },
  },

  // ch. 8 — one dataset drawn on two nets: the ⧉ badges and the layer menu's "Add a view to"
  'views-menu': {
    viewport: VP,
    async stage({ p, ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk, P = W.project;
        W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
        W.menus.run('newnet'); await new Promise((r) => setTimeout(r, 300));
        P.renameDiagram(P.diagrams[1].id, 'Joints');
        P.addDiagram('net', { name: 'Faults' });
        W.rails.activateTab('diag:' + P.diagrams[0].id);
      });
      await wait(400);
      await p.locator('.wtree .wlayer').first().click({ button: 'right' });
      await wait(300);
      await p.locator('[role=menuitem]', { hasText: 'Add a view to' }).hover();
      return { wait: 700 };
    },
  },

  // ch. 9 — a layer opened into its elements: contours, mean + cone, the eigenvector group partly on
  'elements-tree': {
    viewport: VP,
    async stage({ p, ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk, P = W.project;
        W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
        const L = P.layers[0];
        P.setElement(L.id, 'contours', true); P.setElement(L.id, 'mean', true);
        P.setElement(L.id, 'v1Pole', true); P.setElement(L.id, 'v3Pole', true); P.setElement(L.id, 'v1Circle', true);
        W.tree.open.add(L.id); W.tree.open.add(L.id + ':eigen'); W.tree.render();
        W.rails.activateTab('stats');
      });
      await wait(500);
      await p.mouse.move(5, 5);
      return { wait: 700 };
    },
  },

  // ch. 9 — the properties dialog (double-click a layer)
  'layer-props': {
    viewport: VP,
    async stage({ p, ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk, P = W.project;
        W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
        P.setElement(P.layers[0].id, 'contours', true);
      });
      await wait(300);
      await p.locator('.wtree .wlayer').first().dblclick();
      return { el: '.gcu-dialog', wait: 600 };   // the dialog alone: in the whole window its text prints too small
    },
  },

  // ch. 8 — the same data, equal-area lower vs equal-angle upper: two nets side by side would need a split;
  // one net in equal-angle, upper hemisphere, with great circles on, shows the switch
  'net-equal-angle': {
    viewport: VP,
    async stage({ ev }) {
      await ev(async () => {
        const W = window.__wuffleDesk, P = W.project;
        W.menus.run('tocher'); await new Promise((r) => setTimeout(r, 300));
        const g = P.diagrams[0], L = P.layers[0];
        P.setDiagramProps(g.id, { projection: 'equal-angle', hemisphere: 'upper' });
        P.setElement(L.id, 'poles', false); P.setElement(L.id, 'greatCircles', true);
      });
      return { el: '.wn-stage', wait: 700 };
    },
  },
};
