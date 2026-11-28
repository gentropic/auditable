// Scenes for Parts I–VI. Each runs in a fresh lamina page (see build.mjs for the helpers).
const wait = (p, ms) => p.waitForTimeout(ms);
const setVal = (p, sel, v) => p.evaluate(({ sel, v }) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, { sel, v });

export const SCENES = {
  empty: { stage: async () => ({ wait: 600 }) },

  overview: { stage: async ({ sample }) => { await sample(); return { wait: 1500 }; } },

  interpretation: {
    stage: async ({ p, openText }) => {
      await openText('assays.csv', '# exported 2026-11-20\nHOLE;FROM;TO;FE;NOTE\nDH1;0,0;1,5;45,2;"two\nlines"\nDH1;1,5;3,0;51,7;ok\nDH2;0,0;2,0;38,9\nDH2;2,0;4,5;40,1;ok\n');
      await p.click('#kindBadge');
      return { el: '#opts', wait: 700 };
    },
  },

  views: {
    viewport: { width: 1440, height: 760 },
    stage: async ({ ev, sample }) => {
      await sample();
      await ev(() => window.lamina.filter('LITO = "SULPHIDE"'));
      await ev(() => window._lamina.complementView());
      return { wait: 2500 };
    },
  },

  pin: {
    viewport: { width: 1440, height: 900 },
    stage: async ({ p, ev, sample }) => {
      await sample();
      await ev(() => window.lamina.filter('LITO = "SULPHIDE" or LITO = "TRANSITION"'));
      await ev(() => window._lamina.openGroupBy());
      const cu = await ev(() => window.lamina.columns().findIndex((c) => c.name === 'Cu_pct'));
      await p.selectOption('.gb-value', String(cu));
      await p.click('#gbRun'); await p.waitForTimeout(1500);
      await p.click('#helpPin');
      return { wait: 1500 };
    },
  },

  raw: {
    viewport: { width: 1440, height: 520 },
    stage: async ({ ev, openText }) => {
      await openText('notes.csv', 'id,name,note\r\n1,"Smith, J.","said ""hi"""\r\n2,"multi\r\nline",x\r\n3,OXIDE ,\tend\r\n');
      await ev(() => window._lamina.openRawOfFocused('lines'));
      return { wait: 1500 };
    },
  },

  'lens-slots': {
    stage: async ({ ev }) => {
      ev(() => { window.lamina.applyLens({ kind: 'lamina-lens', version: 2, sources: [
        { id: 's1', file: 'model_2025-09.csv', size: 412345678, views: [{ id: 'v1', filter: 'LITO = "SULPHIDE"' }] },
        { id: 's2', file: 'collars.csv', size: 48211, views: [{ id: 'v2' }] }] }).catch(() => {}); });
      return { el: '.help-box', wait: 1200 };
    },
  },

  gutter: {
    stage: async ({ sample }) => { await sample(); return { clip: { x: 0, y: 0, width: 1280, height: 170 }, wait: 1200 }; },
  },

  'columns-panel': {
    stage: async ({ ev, sample }) => { await sample(); await ev(() => window._lamina.toggleColPanel(true)); return { el: '#colPanel', wait: 600 }; },
  },

  drawer: {
    stage: async ({ p, ev, sample }) => {
      await sample();
      await ev(() => window.lamina.filter('LITO in ("SULPHIDE", "TRANSITION") and Cu_pct between 0.5 and 2'));
      await p.click('#filterWidgets');
      return { els: ['#filterWrap', '#fdrawer'], pad: 10, wait: 900 };
    },
  },

  'calc-editor': {
    stage: async ({ p, ev, sample }) => {
      await sample();
      await ev(() => window._lamina.openCalcEditor(null));
      await setVal(p, '#ceName', 't');
      await setVal(p, '#ceExpr', 'dx * dy * dz * density');
      return { el: '#calcEditor', wait: 700 };
    },
  },

  'stats-cu': {
    stage: async ({ ev, sample }) => { await sample(); await ev(() => window._lamina.showColumnStats(8)); return { el: '.help-box', wait: 1800 }; },
  },

  summary: {
    viewport: { width: 1280, height: 860 },
    stage: async ({ ev, sample }) => { await sample(); await ev(() => window._lamina.precomputeStats({ show: true })); return { el: '.help-box', wait: 3500 }; },
  },

  groupby: {
    viewport: { width: 1280, height: 820 },
    stage: async ({ p, ev, sample }) => {
      await sample();
      await ev(() => window._lamina.openGroupBy());
      const cu = await ev(() => window.lamina.columns().findIndex((c) => c.name === 'Cu_pct'));
      const au = await ev(() => window.lamina.columns().findIndex((c) => c.name === 'Au_gpt'));
      const de = await ev(() => window.lamina.columns().findIndex((c) => c.name === 'density'));
      await p.selectOption('.gb-value', String(cu));
      await p.click('#gbAdd'); await wait(p, 200);
      await p.locator('.gb-value').nth(1).selectOption(String(au));
      await p.selectOption('#gbWeight', String(de));
      await p.click('#gbRun');
      return { el: '.help-box', wait: 2500 };
    },
  },

  'gt-report': {
    viewport: { width: 1280, height: 1000 },
    stage: async ({ p, ev, sample }) => {
      await sample();
      await ev(() => window._lamina.openGradeTonnage());
      await p.selectOption('.gt-unit', 'g/t');
      await p.click('#gtRun');
      return { el: '.help-box', wait: 4000 };
    },
  },

  gridsum: {
    stage: async ({ p, ev, sample }) => { await sample(); await ev(() => window._lamina.openGridSummary()); await p.click('#gsRun'); return { el: '.help-box', wait: 2500 }; },
  },

  dq: {
    stage: async ({ ev, openText }) => {
      await openText('codes.csv', 'CODE,VAL,FLAG\n007,1.5,a\n012,-999,b\n013,-999,c\n100,2.5,d\n');
      await ev(() => window._lamina.showDataQuality());
      return { el: '.help-box', wait: 1500 };
    },
  },

  export: {
    stage: async ({ ev, sample }) => { await sample(); await ev(() => window._lamina.openExportDialog()); return { el: '#exportDialog .ex-box', wait: 600 }; },
  },
};
