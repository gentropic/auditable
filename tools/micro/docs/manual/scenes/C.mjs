// scenes for figures/wanted/C.txt (Part III, Seeing) — see ../scenes.mjs for the contract

// open the properties panel on a tab, for the active layer
const openPropsTab = (h, tab) => h.ev(async (t) => {
  const m = window._micro;
  m.openProps();
  const b = [...document.querySelectorAll('#ppTabs .pp-tab')].find((x) => x.textContent.trim() === t);
  if (b) b.click();
}, tab);
const closeProps = (h) => h.ev(() => { const pp = document.querySelector('#propPanel'); if (pp && pp.classList.contains('show')) { const x = pp.querySelector('.pp-close, .x, [data-close]'); if (x) x.click(); else pp.classList.remove('show'); } });
const setClip = (h, lo, hi) => h.ev(([a, b]) => {
  for (const [id, v] of [['clipMin', a], ['clipMax', b]]) { const e = document.querySelector('#' + id); e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }
}, [lo, hi]);
const bboxOf = (h, sel) => h.ev((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, sel);

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
const setSec = (h, id, val, ev = 'input') => h.ev(([i, v2, e2]) => { const e = document.querySelector('#' + i); e.value = v2; e.dispatchEvent(new Event(e2)); }, [id, val, ev]);
const dolly = (h, f) => h.ev((f2) => { const m = window._micro; m.cam.dolly(f2); m.requestRender(); }, f);

export const SCENES = {
  'color-props-style': async (h) => {
    await h.ev(async () => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      m.setActiveLayer(L.id);
      await m.scanColumns(L, null, { columns: ['FE'] });
    });
    await setClip(h, '', '');   // automatic range: every break falls inside the histogram
    await h.ev(() => { const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv'); m.setRampCfg(L, { preset: 'viridis', classed: true, breaks: [20, 40, 55, 60, 65], colors: null, hide: null }); });
    await openPropsTab(h, 'style');
    await h.p.waitForTimeout(600);
    const r = await h.ev(() => {
      const pp = document.querySelector('#propPanel'), pr = pp.getBoundingClientRect();
      const rows = [...pp.querySelectorAll('.pp-row')];
      const mode = rows.find((x) => /^\s*mode/.test(x.textContent));
      const bulk = pp.querySelector('.pp-bulk');
      const top = (mode || pp).getBoundingClientRect().top - 6, bot = (bulk || pp).getBoundingClientRect().bottom + 3;
      return { x: pr.left, y: top, width: pr.width, height: bot - top };
    });
    return { clip: r, blankOk: true, after: async () => {
      await h.ev(() => { const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv'); m.setRampCfg(L, { classed: false, breaks: [], colors: null, hide: null }); });
      await setClip(h, '', ''); await closeProps(h);
    } };
  },

  'color-categories': async (h) => {
    await openPropsTab(h, 'style');
    const prev = await h.ev(() => document.querySelector('#colorBy').value);
    await h.ev(async () => {
      const ms = [...document.querySelectorAll('#propPanel .pp-row')].find((x) => /^\s*mode/.test(x.textContent)).querySelector('select');
      ms.value = 'categorized'; ms.dispatchEvent(new Event('change'));
    });
    await h.p.waitForFunction(() => document.querySelectorAll('#propPanel .pp-cat').length >= 4 && ![...document.querySelectorAll('#propPanel .pp-cat .ct')].some((c) => c.textContent === '…'), null, { timeout: 60000 });
    await h.ev(() => {
      const row = [...document.querySelectorAll('#propPanel .pp-cat')].find((r) => r.querySelector('.nm').textContent === 'WASTE');
      const eye = row.querySelector('input[type=checkbox]'); if (eye.checked) eye.click();
    });
    await h.p.waitForTimeout(500);
    const clip = await h.ev(() => {
      const pp = document.querySelector('#propPanel'), pr = pp.getBoundingClientRect();
      const col = [...pp.querySelectorAll('.pp-row')].find((x) => /^\s*column/.test(x.textContent));
      const cats = [...pp.querySelectorAll('.pp-cat')];
      const top = col.getBoundingClientRect().top - 6, bot = cats[cats.length - 1].getBoundingClientRect().bottom + 6;
      return { x: pr.left, y: top, width: pr.width, height: bot - top };
    });
    return { clip, blankOk: true, after: async () => {
      await h.ev((v) => {
        const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
        const row = [...document.querySelectorAll('#propPanel .pp-cat')].find((r) => r.querySelector('.nm').textContent === 'WASTE');
        if (row) { const eye = row.querySelector('input[type=checkbox]'); if (!eye.checked) eye.click(); }
        if (L.catHidden) L.catHidden.clear();
        const cb = document.querySelector('#colorBy'); cb.value = v; cb.dispatchEvent(new Event('change'));
      }, prev);
      await closeProps(h);
    } };
  },

  'sections-bar': async (h) => {
    const v = await saveView(h);
    await h.fit(); await h.p.waitForTimeout(600);   // from the demo's framing, whatever ran before
    await setSec(h, 'secClip', 'slab', 'change'); await setSec(h, 'secClip', 'slab'); await setSec(h, 'secHalf', '5');
    await h.p.mouse.move(900, 500); await h.p.keyboard.press('l');
    await dolly(h, 0.42);
    // the cut face's top edge just under the toolbar, centered under the section controls
    await h.ev(() => { const m = window._micro, st = m.cam.state; st.target = [st.target[0] + 350, st.target[1], -330]; m.cam.update(); m.requestRender(); });
    await h.p.waitForTimeout(800);
    const clip = await h.ev(() => {
      const a = document.querySelector('#zExag').getBoundingClientRect(), b = document.querySelector('#sec2DW').getBoundingClientRect(), bar = document.querySelector('#bar2').getBoundingClientRect();
      const x = a.left - 30; return { x, y: bar.top, width: Math.min(innerWidth, b.right + 12) - x, height: bar.height + 300 };
    });
    return { clip, wait: 1800, after: () => restoreView(h, v) };
  },

  'sections-whole-holes': async (h) => {
    const v = await saveView(h);
    await h.fit(); await h.p.waitForTimeout(600);   // from the demo's framing, whatever ran before
    const prev = await h.ev(() => { const m = window._micro, dh = m.layers().find((L) => L.dh), tp = m.layers().find((L) => L.label === 'topography'); return { dh: m.renderer.layerSectioned(dh.id), tp: m.renderer.layerSectioned(tp.id) }; });
    await setSec(h, 'secClip', 'slab', 'change'); await setSec(h, 'secClip', 'slab'); await setSec(h, 'secHalf', '5');
    // the demo's own E–W position (0.45): the holes are N-drilled fans from collars south of the lens, so the
    // eight MERIDIAN holes cross it and PIONEER's four short scout holes stop before it (hidden in this mode)
    await h.ev(() => { const m = window._micro, dh = m.layers().find((L) => L.dh), tp = m.layers().find((L) => L.label === 'topography'); m.renderer.setLayerSectioned(dh.id, { whole: true }); m.renderer.setLayerSectioned(tp.id, true); m.requestRender(); });
    // ⇧L faces the section from the SOUTH — the collars' side — so each hole runs from its collar toward
    // the camera's side of the slab; then a quarter-turn off square so each fan opens out
    await h.p.mouse.move(900, 500); await h.p.keyboard.press('Shift+L');
    await h.ev(() => { const m = window._micro, st = m.cam.state; st.theta += 0.95; m.cam.update(); m.requestRender(); });
    await dolly(h, 0.6);
    return { wait: 2500, after: async () => {
      await h.ev((pv) => { const m = window._micro, dh = m.layers().find((L) => L.dh), tp = m.layers().find((L) => L.label === 'topography'); m.renderer.setLayerSectioned(dh.id, pv.dh); m.renderer.setLayerSectioned(tp.id, pv.tp); }, prev);
      await restoreView(h, v);
    } };
  },

  'pick-record-panel': async (h) => {
    const v = await saveView(h);
    await h.fit(); await h.p.waitForTimeout(600);
    await h.p.mouse.move(900, 500); await h.p.keyboard.press('l');
    await dolly(h, 0.6);
    await h.p.waitForTimeout(800);
    await h.p.mouse.click(720, 600);            // opens the record panel (the view narrows), then the real pick
    await h.p.waitForTimeout(800);
    // the highest-grade block on the cut face itself (the panel title says "section cut")
    const fe = () => h.ev(() => { if (!/section cut/.test(document.querySelector('#rpTitle').textContent)) return -1; const t = document.querySelector('#rpList').innerText.match(/FE\s+([\d.]+)/); return t ? +t[1] : -1; });
    let best = null;
    const pts = []; for (let x = 600; x <= 880; x += 40) for (let y = 430; y <= 500; y += 14) pts.push([x, y]);
    for (const [x, y] of pts) {
      await h.p.mouse.click(x, y); await h.p.waitForTimeout(500);
      const f = await fe(); if (!best || f > best.f) best = { x, y, f };
    }
    await h.p.mouse.click(best.x, best.y);
    await h.p.mouse.move(1200, 850);
    return { wait: 1800, after: async () => {
      await h.ev(() => { const c = document.querySelector('#rpClose'); if (c) c.click(); });
      await restoreView(h, v);
    } };
  },

  'pick-paint-palette': async (h) => {
    const v = await saveView(h);
    await h.fit(); await h.p.waitForTimeout(600);   // from the demo's framing, whatever ran before
    await h.p.mouse.move(900, 500); await h.p.keyboard.press('l');
    await dolly(h, 0.6);
    const lid = await h.ev(() => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      const col = m.createPaintCol(L, 'DOMAIN'); m.addPaintValue(L, col, 'CORE'); m.addPaintValue(L, col, 'HALO');
      m.openPaintPalette(L);
      return L.id;
    });
    await h.p.waitForTimeout(800);
    const drag = async (x0, y0, x1, y1) => { await h.p.mouse.move(x0, y0); await h.p.mouse.down(); await h.p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await h.p.mouse.move(x1, y1, { steps: 4 }); await h.p.mouse.up(); await h.p.waitForTimeout(700); };
    await h.ev((id) => window._micro.paintArm(id, 'DOMAIN', 2), lid);
    await drag(560, 410, 900, 530);
    await h.ev((id) => window._micro.paintArm(id, 'DOMAIN', 1), lid);
    await drag(660, 440, 790, 495);
    await h.ev(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /^paint/.test(e.querySelector('.t').textContent)); if (w) { w.style.height = '250px'; if (w._onResized) w._onResized(); } });
    return { el: h.win('paint'), wait: 900, after: async () => {
      await h.ev((id) => {
        const m = window._micro, L = m.layers().find((x) => x.id === id);
        m.paintDisarm(); m.closeAllWindows();
        L.paintCols = (L.paintCols || []).filter((c) => c.name !== 'DOMAIN'); L._colStats = null; L._paintUndo = [];
        const cb = document.querySelector('#colorBy');
        for (const o of [...cb.options]) if (o.value === 'paint:DOMAIN') o.remove();
        if (cb.value !== 'chan:3') { cb.value = 'chan:3'; cb.dispatchEvent(new Event('change')); }
      }, lid);
      await restoreView(h, v);
    } };
  },

  'filter-drawer': async (h) => {
    const v = await saveView(h);
    await h.fit(); await h.p.waitForTimeout(600);
    await h.ev(async () => {
      const e = 'FE > 55 and (LITO = "HEMATITE" or LITO = "CANGA")';
      document.querySelector('#filter').value = e; await window._micro.applyBlockFilter(e);
      window._micro.toggleFilterDrawer(true);
    });
    await h.p.waitForTimeout(1500);
    const clip = await h.ev(() => {
      const f = document.querySelector('#filterWrap').getBoundingClientRect(), d = document.querySelector('#fdrawer').getBoundingClientRect();
      const x = Math.min(f.left, d.left) - 16, r = Math.max(f.right, d.right) + 16;
      return { x, y: f.top - 6, width: r - x, height: d.bottom + 140 - (f.top - 6) };
    });
    return { clip, wait: 1500, after: async () => { await h.ev(() => window._micro.toggleFilterDrawer(false)); await restoreView(h, v); } };
  },

  'filter-calc-window': async (h) => {
    const prev = await h.ev(() => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      const was = L.calcCols ? L.calcCols.slice() : [];
      L.calcCols = [...was.filter((c) => c.name !== 'DENS'), { name: 'DENS', expr: 'if(LITO = "HEMATITE", 4.2, if(LITO = "ITABIRITE", 3.4, if(LITO = "CANGA", 3.0, 2.7)))', ty: 'number' }];
      m.openCalcWindow(L, L.calcCols.length - 1);
      return was.length;
    });
    await h.p.waitForTimeout(500);
    await h.ev(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /calculations/.test(e.querySelector('.t').textContent)); if (w) { w.style.left = '360px'; w.style.top = '110px'; w.style.width = '880px'; w.style.height = '420px'; if (w._onResized) w._onResized(); } });
    await h.p.waitForTimeout(500);
    return { el: h.win('calc|ƒ'), blankOk: true, after: () => h.ev((n) => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      m.closeAllWindows(); L.calcCols = (L.calcCols || []).filter((c) => c.name !== 'DENS'); L._calcFns = null;
    }, prev) };
  },
};
