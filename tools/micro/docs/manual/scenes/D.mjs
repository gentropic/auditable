// scenes for figures/wanted/D.txt (Part IV, Analysis: 14-analysis … 19-validation) — see ../scenes.mjs

// a floating window by its title, moved and sized so the picture reads
const place = (h, re, x, y, w, ht) => h.ev(([src, x2, y2, w2, h2]) => {
  const el = [...document.querySelectorAll('.fwin')].find((e) => new RegExp(src, 'i').test(e.querySelector('.t').textContent));
  if (!el) return false;
  el.style.left = x2 + 'px'; el.style.top = y2 + 'px'; if (w2) el.style.width = w2 + 'px'; if (h2) el.style.height = h2 + 'px';
  if (el._onResized) el._onResized();
  return true;
}, [re, x, y, w, ht]);
const closeAll = (h) => h.ev(() => window._micro.closeAllWindows());

// numbered callouts: amber circles with a dark number, placed on real elements' rects
const callouts = (h, list) => h.ev((items) => {
  for (const it of items) {
    const e = it.find ? it.find() : null;
    const el = typeof it.sel === 'string' ? document.querySelector(it.sel) : null;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const b = document.createElement('div'); b.className = 'manual-callout'; b.textContent = it.n;
    const L0 = it.right ? r.right - 24 + (it.dx || 0) : r.left + (it.dx || 0), T0 = it.bottom ? r.bottom - 24 + (it.dy || 0) : r.top + (it.dy || 0);
    b.style.cssText = `position:fixed;z-index:99999;left:${L0}px;top:${T0}px;width:24px;height:24px;border-radius:50%;background:#e8a33c;color:#141414;font:700 14px/24px "Barlow","Segoe UI",Arial,sans-serif;text-align:center;box-shadow:0 0 0 2px #141414;pointer-events:none;`;
    document.body.appendChild(b);
  }
}, list);
const clearCallouts = (h) => h.ev(() => document.querySelectorAll('.manual-callout').forEach((x) => x.remove()));

// wait until a window's subtitle says it has a result (not scanning / configure / sampling)
const waitDone = (h, re) => h.p.waitForFunction((src) => {
  const w = [...document.querySelectorAll('.fwin')].find((e) => new RegExp(src, 'i').test(e.querySelector('.t').textContent));
  if (!w) return false;
  const t = (w.querySelector('.sub') || {}).textContent || '';
  return t && !/scanning|configure|Run to compute|sampling|pick the samples|running/i.test(t);
}, re, { timeout: 90000 });
const L0 = (h) => h.ev(() => window._micro.layers().find((x) => x.name === 'deposit.csv').id);

// the camera and the section bar, captured so a scene can put them back
const saveView = (h) => h.ev(() => {
  const st = window._micro.cam.state, q = (id) => document.querySelector('#' + id);
  return { cam: JSON.parse(JSON.stringify({ target: st.target, radius: st.radius, theta: st.theta, phi: st.phi })), clip: q('secClip').value, half: q('secHalf').value, pos: q('secPos').value, mode: q('secMode').value };
});
const restoreView = (h, v) => h.ev((v2) => {
  const m = window._micro, q = (id) => document.querySelector('#' + id);
  const set = (id, val, ev) => { const e = q(id); if (e.value !== val) { e.value = val; e.dispatchEvent(new Event(ev)); } };
  set('secMode', v2.mode, 'input'); set('secClip', v2.clip, 'change'); set('secHalf', v2.half, 'input'); set('secPos', v2.pos, 'input');
  Object.assign(m.cam.state, v2.cam); m.cam.update(); m.requestRender();
}, v);
// section off, the whole model framed, shifted left to leave the right of the view for a window
const modelLeft = (h, px = 260) => h.ev((dx) => {
  const m = window._micro, e = document.querySelector('#secMode'); e.value = 'off'; e.dispatchEvent(new Event('input'));
  m.cam.fit(m.docBbox()); m.cam.dolly(1.25); m.cam.pan(dx, 0, document.querySelector('#cv').clientHeight); m.requestRender();
}, px);
const setShown = (h, labels, on) => h.ev(([ls, on2]) => {
  const m = window._micro, done = [];
  for (const L of m.layers()) {
    const nm = L.label || L.name;
    if (!ls.includes(nm) || L.visible === on2) continue;
    // through the layers panel's own checkbox, so the panel shows what the view shows
    const row = [...document.querySelectorAll('#lpRows *')].find((e) => e.children.length === 0 && e.textContent.trim() === nm);
    const cb = row && row.closest('#lpRows > *') && row.closest('#lpRows > *').querySelector('input[type=checkbox]');
    if (cb) cb.click(); else { L.visible = on2; m.renderer.setLayerVisible(L.id, on2); m.applyTreeVisibility(); }
    done.push(nm);
  }
  m.requestRender(); return done;
}, [labels, on]);
async function openSwathRun(h, extra = {}) {
  await h.ev((x) => {
    const m = window._micro, L = m.layers().find((q) => q.name === 'deposit.csv');
    m.openSwath(L, { cfg: { series: [{ layer: 'deposit.csv', col: 'FE', unit: 'pct', weight: 'SG', filter: '' }], mode: 'axes', axis: 0, bars: 'count', gradeUnit: 'pct', scope: 'all', bandW: {}, off: {}, locate: true, ...x }, run: true });
  }, extra);
  await h.p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /^swath/.test(e.querySelector('.t').textContent)); return w && w._swathSpec; }, null, { timeout: 90000 });
}
const swathAfter = (h, v) => async () => {
  await h.p.keyboard.press('Escape');
  await h.ev(() => { document.querySelectorAll('.menu').forEach((x) => x.remove()); window._micro.closeAllWindows(); window._micro.setSwathBand(null); });
  if (v) await restoreView(h, v);
};

const GT_CFG = { series: [{ layer: 'deposit.csv', col: 'FE', unit: 'pct', weight: 'SG', filter: '' }], nCut: 40, scope: 'all', gradeUnit: 'pct', densUnit: 't/m3' };
async function openGT(h) {
  await h.ev((cfg) => { const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv'); m.openGradeTonnage(L, { cfg, run: true }); }, GT_CFG);
  await h.p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /grade-tonnage/.test(e.querySelector('.t').textContent)); return w && w._gtSpec; }, null, { timeout: 60000 });
  await place(h, 'grade-tonnage', 330, 90, 780, 560);
}

export const SCENES = {
  'gt-window': async (h) => {
    await openGT(h);
    return { el: h.win('grade-tonnage'), blankOk: true, after: () => closeAll(h) };
  },

  'analysis-anatomy': async (h) => {
    await openGT(h);
    await h.p.waitForTimeout(400);
    await callouts(h, [
      { n: '1', sel: '.fwin .sw-rail', right: true, dx: -12, dy: 8 },
      { n: '2', sel: '.fwin .sw-main', dx: 8, dy: 8 },
      { n: '3', sel: '.fwin .sw-foot', right: true, bottom: true, dx: -44, dy: -42 },
    ]);
    return { el: h.win('grade-tonnage'), blankOk: true, after: async () => { await clearCallouts(h); await closeAll(h); } };
  },

  'xtab-window': async (h) => {
    await h.ev(async () => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      const w = m.openCrosstab(L, { cfg: { group: 'LITO', grade: 'FE', weight: 'SG', cutoffs: '30 40 50 60', densUnit: 't/m3', gradeUnit: 'pct', measure: 'tonnage', mode: 'bins', scope: 'all', filter: '' } });
      await w.run();
    });
    await waitDone(h, 'cross-tab');
    await place(h, 'cross-tab', 300, 100, 900, 520);
    return { el: h.win('cross-tab'), blankOk: true, after: () => closeAll(h) };
  },

  'stats-window': async (h) => {
    await h.ev(() => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      m.openStats(L, { cfg: { cols: ['FE', 'SG'], groupBy: 'LITO', weight: '', scope: 'all' }, run: true });
    });
    await waitDone(h, '^stats');
    await place(h, '^stats', 300, 110, 900, 380);
    return { el: h.win('^stats'), blankOk: true, after: () => closeAll(h) };
  },

  'scatter-window': async (h) => {
    await h.ev(() => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      m.openXyPlot(L, { cfg: { mode: 'scatter', x: 'FE', y: 'SG', filter: '', scope: 'all', logX: false, logY: false, line11: false }, run: true });
    });
    await waitDone(h, 'scatter');
    await place(h, 'scatter', 300, 90, 860, 560);
    return { el: h.win('scatter'), blankOk: true, after: () => closeAll(h) };
  },

  'qq-window': async (h) => {
    await h.ev(() => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      m.openXyPlot(L, { cfg: { mode: 'qq', qqLog: false, a: { layer: 'demo_assay.csv', col: 'FE', filter: '', scope: 'all' }, b: { layer: 'deposit.csv', col: 'FE', filter: '', scope: 'all' } }, run: true });
    });
    await waitDone(h, 'scatter');
    await place(h, 'scatter', 300, 90, 860, 560);
    return { el: h.win('scatter'), blankOk: true, after: () => closeAll(h) };
  },

  'validation-window': async (h) => {
    // the way the book says: ⌘K → "Validate vs drillholes…"
    await h.p.mouse.move(900, 500);
    await h.ev(() => { window._micro.openPalette(); const i = document.querySelector('#palInput'); i.value = 'Validate vs drillholes'; i.dispatchEvent(new Event('input')); });
    await h.p.waitForTimeout(300);
    await h.p.keyboard.press('Enter');
    await h.p.waitForFunction(() => [...document.querySelectorAll('.fwin .t')].some((e) => /^validate/.test(e.textContent)), null, { timeout: 10000 });
    await waitDone(h, '^validate');
    await h.ev(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /^validate/.test(e.querySelector('.t').textContent)); [...w.querySelectorAll('.pp-segbtn')].find((b) => b.textContent === 'Z').click(); });
    await h.p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /^validate/.test(e.querySelector('.t').textContent)); return /Z \(/.test(w.querySelector('.sub').textContent); }, null, { timeout: 60000 });
    await place(h, '^validate', 330, 100, 760, 500);
    await h.p.waitForTimeout(500);
    return { el: h.win('^validate'), blankOk: true, after: () => closeAll(h) };
  },

  'pairing-window': async (h) => {
    await h.ev(async () => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      const e = m.openPairing(L);
      const rail = e.win.el.querySelector('.sw-rail'), rows = [...rail.querySelectorAll('.sw-row')];
      const pick = (label, v) => { const r = rows.find((x) => x.querySelector('span') && x.querySelector('span').textContent === label); const sl = r.querySelector('select'); const o = [...sl.options].find((q) => q.value === v || q.textContent === v); sl.value = o.value; sl.dispatchEvent(new Event('change')); };
      pick('samples', 'holes · demo_assay.csv'); pick('sample', 'FE'); pick('block', 'FE'); pick('by', 'LITO');
      [...rail.querySelectorAll('button')].find((b) => b.textContent === 'Run').click();
    });
    await h.p.waitForFunction(() => { const e = [...window._micro.pairWins.values()][0]; return e && e.st.res; }, null, { timeout: 90000 });
    await place(h, 'block vs sample', 300, 90, 880, 600);
    await h.p.waitForTimeout(500);
    return { el: h.win('block vs sample'), blankOk: true, after: () => closeAll(h) };
  },

  'swath-window': async (h) => {
    await openSwathRun(h);
    await place(h, '^swath', 300, 100, 820, 520);
    return { el: h.win('^swath'), blankOk: true, after: swathAfter(h) };
  },

  'swath-zebra': async (h) => {
    const v = await saveView(h);
    await openSwathRun(h, { bandW: { 0: 200 } });
    await modelLeft(h, -160);
    await place(h, '^swath', 870, 110, 550, 440);
    await h.ev(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /^swath/.test(e.querySelector('.t').textContent)); const zc = w.querySelector('input[id^="sw-zebra-"]'); if (!zc.checked) zc.click(); });
    // the topography veil and the ore shell sit over the model's top: out of the way, so the stripes read
    const hid = await setShown(h, ['topography', 'ore shell'], false);
    return { wait: 2500, after: async () => { await swathAfter(h, v)(); await setShown(h, hid, true); } };
  },

  'swath-band-ghost': async (h) => {
    const v = await saveView(h);
    await openSwathRun(h, { bandW: { 0: 200 } });
    await modelLeft(h, -160);
    await place(h, '^swath', 870, 110, 550, 440);
    await h.p.waitForTimeout(600);
    const r = await h.ev(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /^swath/.test(e.querySelector('.t').textContent)); const c = w.querySelector('.sw-main canvas').getBoundingClientRect(); return { x: c.left, y: c.top, w: c.width, h: c.height }; });
    const y = r.y + r.h * 0.5;
    await h.p.mouse.move(r.x + r.w * 0.42, y);
    await h.p.mouse.down();
    await h.p.mouse.move(r.x + r.w * 0.52, y, { steps: 5 });
    await h.p.mouse.move(r.x + r.w * 0.62, y, { steps: 5 });
    await h.p.mouse.up();
    return { wait: 2000, after: swathAfter(h, v) };
  },

  'resource-table-frame': async (h) => {
    const nf0 = await h.ev(async () => {
      const m = window._micro, before = m.figures().slice();
      // what File → Composer… → + resource → Add hands addResourceFrame (openResourceDialog's p)
      const f = await m.addResourceFrame({ layer: 'deposit.csv', grade: 'FE', gradeUnit: '%', cutoffs: [30, 50, 60], density: { col: 'SG', unit: 't/m3' }, groupBy: ['LITO'], metalFactor: 0.01, metalUnit: 't', scope: 'all' });
      // the figure the frame went into is the composer's CURRENT one (S.figures is kept sorted by
      // name, so "the last figure" is not it); remember it, and whether the call made it
      window.__manualResFig = { fig: m.currentFigure(), frame: f, made: !before.includes(m.currentFigure()) };
      return 0;
    });
    // 150 % so the table is drawn at a readable size, then deselect (no handles in the picture)
    await h.ev(() => { const z = [...document.querySelectorAll('.composer-win select')].find((s) => [...s.options].some((o) => o.textContent === '150%')); z.value = '5.67'; z.dispatchEvent(new Event('change')); });
    await h.p.waitForTimeout(500);
    const pg = await h.ev(() => { const c = [...document.querySelectorAll('.composer-win canvas')].find((x) => !x.className); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    void pg;
    await h.ev(() => window._micro.composerEditor().select([]));   // the editor's own “select nothing”: no handles in the picture
    await h.p.waitForTimeout(500);
    const clip = await h.ev(() => {
      const f = window.__manualResFig.frame;
      const c = [...document.querySelectorAll('.composer-win canvas')].find((x) => !x.className), r = c.getBoundingClientRect(), z = 5.67, pad = 6;
      return { x: r.left + f.box[0] * z - pad, y: r.top + f.box[1] * z - pad, width: f.box[2] * z + 2 * pad, height: f.box[3] * z * 0.93 + pad };   // the frame's box runs a little past the note
    });
    void nf0;
    return { clip, blankOk: true, after: () => h.ev(() => {
      const m = window._micro, r = window.__manualResFig; m.closeAllWindows();
      if (r) {
        if (r.made) { const i = m.figures().indexOf(r.fig); if (i >= 0) m.figures().splice(i, 1); }
        else if (r.fig && r.fig.doc) r.fig.doc.frames = r.fig.doc.frames.filter((x) => x !== r.frame);
      }
      delete window.__manualResFig;
    }) };
  },
};
