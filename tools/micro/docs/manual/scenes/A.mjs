// scenes for figures/wanted/A.txt (Part I: 02-start, 03-tour) — see ../scenes.mjs for the contract

// ── shared bits ──
// the demo's grade–tonnage window, as openDemoProject docks it (right, top 70)
const openDemoGT = (h) => h.ev(() => {
  const m = window._micro, bm = m.layers().find((L) => L.name === 'deposit.csv');
  m.openGradeTonnage(bm, { run: true });
  const w = [...document.querySelectorAll('.fwin')].pop();
  if (w) { w.style.left = Math.max(0, innerWidth - w.offsetWidth - 14) + 'px'; w.style.top = '70px'; }
});
// the union of some elements' rects, padded, clamped to the viewport — a region clip
const clipOf = (h, sels, pad = 8) => h.ev(([ss, pd]) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const s of ss) for (const e of document.querySelectorAll(s)) {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
  }
  x0 = Math.max(0, x0 - pd); y0 = Math.max(0, y0 - pd); x1 = Math.min(innerWidth, x1 + pd); y1 = Math.min(innerHeight, y1 + pd);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}, [sels, pad]);
// the layers-panel row of a layer / group, by its label
const rowSel = (label) => `#lpRows .lp-row:has-text("${label}")`;
// widen the layers panel so long names read in full (restored by narrowPanel)
const widenPanel = (h, w = 300) => h.ev((ww) => { const P = document.querySelector('#layersPanel'); P.dataset.w0 = P.style.width || ''; P.style.width = ww + 'px'; }, w);
const narrowPanel = (h) => h.ev(() => { const P = document.querySelector('#layersPanel'); P.style.width = P.dataset.w0 || ''; });
const setGroupCollapsed = (h, name, collapsed) => h.ev(([n, c]) => {
  const m = window._micro, nd = m.layerTree().find((x) => typeof x !== 'number' && x.name === n);
  if (nd) { nd.collapsed = c; m.renderLayers(); }
}, [name, collapsed]);


// back to the opening camera + section: 2D off, the demo's bookmark (camera + section), fit —
// the same order openDemoProject uses; the holes back to "don't cut"
const restoreView = (h) => h.ev(() => {
  const m = window._micro, c2 = document.querySelector('#sec2D');
  if (c2.checked) { c2.checked = false; c2.dispatchEvent(new Event('input')); }
  const v = m.views().find((x) => x.name === 'Ore lens — E–W section');
  if (v) m.applyView(v);
  m.applySection({ mode: 'ew', clip: 'behind', pos: 0.45, half: 5 });
  const dh = m.layers().find((L) => L.dh && L.docs && L.docs.dhDoc); if (dh) m.renderer.setLayerSectioned(dh.id, false);
  document.querySelector('#btnFit').click();
  const rp = document.querySelector('#recPanel'); if (rp.classList.contains('show')) document.querySelector('#rpClose').click();
});
const PICK = { x: 712, y: 470 };                         // the lens core on the faced section
const press = async (h, key) => { await h.p.mouse.move(700, 500); await h.p.keyboard.press(key); };
const setFilter = (h, expr) => h.ev(async (e) => { document.querySelector('#filter').value = e; await window._micro.applyBlockFilter(e); }, expr);
const placeWin = (h, re, x, y, w, ht) => h.ev(([src, x2, y2, w2, h2]) => {
  const el = [...document.querySelectorAll('.fwin')].find((e) => new RegExp(src).test(e.querySelector('.t').textContent));
  if (!el) return false;
  el.style.left = x2 + 'px'; el.style.top = y2 + 'px'; if (w2) el.style.width = w2 + 'px'; if (h2) el.style.height = h2 + 'px';
  if (el._onResized) el._onResized();
  return true;
}, [re, x, y, w, ht]);
// numbered callouts: amber discs placed beside measured elements; removed by clearBadges
const badges = (h, list) => h.ev((L) => {
  const host = document.createElement('div'); host.id = '_badges';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
  for (const b of L) {
    const e = document.querySelector(b.sel); if (!e) continue;
    const r = e.getBoundingClientRect();
    const ax = b.ax ?? 0, ay = b.ay ?? 0.5;               // anchor on the element (0..1)
    const x = r.left + r.width * ax + (b.dx || 0), y = r.top + r.height * ay + (b.dy || 0);
    const d = document.createElement('div'); d.textContent = b.n;
    d.style.cssText = `position:absolute;left:${x - 11}px;top:${y - 11}px;width:22px;height:22px;border-radius:50%;background:#e0a526;color:#121212;font:700 13px/22px Barlow, 'Segoe UI', Arial, sans-serif;text-align:center;box-shadow:0 0 0 2px #121212, 0 1px 6px rgba(0,0,0,.6)`;
    host.append(d);
  }
  document.body.append(host);
}, list);
const clearBadges = (h) => h.ev(() => { const b = document.querySelector('#_badges'); if (b) b.remove(); });

const CLASS_EXPR = 'if(FE > 58, 2, if(FE > 45, 1, 0))';
const addClass = (h) => h.ev((e) => { const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv'); m.applyCalcCols(L, [{ name: 'CLASS', expr: e, ty: 'number' }]); }, CLASS_EXPR);
const colorBy = (h, re) => h.ev((src) => {
  const cb = document.querySelector('#colorBy'), o = [...cb.options].find((x) => new RegExp(src).test(x.textContent));
  if (!o) return [...cb.options].map((x) => x.value + '=' + x.textContent);
  cb.value = o.value; cb.dispatchEvent(new Event('change')); return o.value;
}, re);
// drop CLASS again and color by FE, as the demo opens
const dropClass = (h) => h.ev(() => {
  const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
  const cb = document.querySelector('#colorBy'), o = [...cb.options].find((x) => /^FE$/.test(x.textContent.trim()) || (/FE/.test(x.textContent) && x.value.startsWith('chan:')));
  if (o) { cb.value = o.value; cb.dispatchEvent(new Event('change')); }
  L.calcCols = []; L._calcFns = null; L._colStats = null;
});

const STEP_GT = 'with:\n  layer: "deposit.csv"\n  series:\n    - col: "FE"\n      unit: "pct"\n      weight: "SG"\n  gradeUnit: "pct"\n  cutoffs:\n    - 30\n    - 40\n    - 50\n    - 55\n    - 60';
const STEP_STATS = 'with:\n  layer: "deposit.csv"\n  cols:\n    - "FE"\n    - "SG"\n  groupBy: "LITO"';
// the routine editor filled in as the chapter types it: name, two inline steps, then Preview
async function fillFirstLook(h) {
  await h.ev(() => window._micro.openRoutineWindow(null));
  const W = '.fwin[data-routine]';
  await h.p.waitForSelector(W);
  // a new routine starts with one empty "run a recipe" row; the chapter's steps are inline ones
  await h.ev((w) => { const el = document.querySelector(w), st = el.querySelector('.rw-step'); if (st && !st.querySelector('textarea[placeholder^="params"]')) [...st.querySelectorAll('button')].find((b) => b.textContent === '×').click(); }, W);
  await h.p.locator(`${W} button:text-is("+ inline step")`).click();
  await h.p.locator(`${W} button:text-is("+ inline step")`).click();
  await h.ev(([w, a, b]) => {
    const el = document.querySelector(w);
    const fire = (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); };
    fire(el.querySelector('input[placeholder="month-end"]'), 'first look');
    const steps = [...el.querySelectorAll('.rw-step')].filter((x) => x.querySelector('textarea[placeholder^="params"]'));
    const set = (st, tool, as, yaml) => {
      fire(st.querySelector('select'), tool);
      fire([...st.querySelectorAll('input')].find((i) => i.type !== 'checkbox'), as);
      const ta = st.querySelector('textarea'); fire(ta, yaml); ta.style.height = (yaml.split('\n').length * 15 + 12) + 'px';
    };
    set(steps[0], 'gt', 'gt', a);
    // the step rows re-render on change: look them up again
    const steps2 = [...el.querySelectorAll('.rw-step')].filter((x) => x.querySelector('textarea[placeholder^="params"]'));
    set(steps2[1], 'stats', 'stats', b);
  }, [W, STEP_GT, STEP_STATS]);
  return W;
}

// save the demo as a project into OPFS (no picker: showDirectoryPicker answers with an OPFS folder)
async function saveDemoToOpfs(h, name = 'manual-demo') {
  await h.ev(async (nm) => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(nm, { recursive: true }); } catch {}
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(nm, { create: true });
    try { localStorage.setItem('micro.autoPackMeshes', 'off'); } catch {}
    window._micro.setAutoOptimize('off');
  }, name);
  h.ev(() => window._micro.saveProjectAs());
  await h.p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || document.querySelector('#pmDlg.show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await h.ev(() => { if (document.querySelector('#pmDlg.show')) document.querySelector('#pmCancel').click(); });   // the .wfr offer, if asked
  await h.p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await h.ev(() => { if (document.querySelector('#svDlg').classList.contains('show')) document.querySelector('#svCopy').click(); });
  await h.p.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 180000 });
  await h.ev(() => { if (document.querySelector('#pmDlg.show')) document.querySelector('#pmCancel').click(); });
}
// back to a clean slate (File → New project); the next reset reopens a fresh, project-less demo
async function clearSlate(h) {
  await h.ev(() => { window._micro.closeAllWindows(); window._micro.COMMANDS.find((c) => c.id === 'newproj').run(); });
  await h.p.waitForSelector('#pmDlg.show');
  await h.p.click('#pmOk');
  await h.p.waitForFunction(() => !window._micro.layers().length);
  await h.ev(() => { const rl = window._micro._recipesList(); for (let i = rl.length - 1; i >= 0; i--) if (rl[i].name === 'first look') rl.splice(i, 1); });
}

// composer helpers — all through its own controls
const C = '.composer-win';
const cmpPick = (h, id) => h.p.locator(`${C} b.id:text-is("${id}")`).click();
const cmpBox = (h, id, box) => cmpPick(h, id).then(() => h.ev(([w, b]) => {
  const el = document.querySelector(w);
  const row = (lab) => [...el.querySelectorAll('.row')].find((r) => r.firstElementChild && r.firstElementChild.textContent.trim() === lab);
  const ins = [...row('position').querySelectorAll('input'), ...row('size').querySelectorAll('input')];
  b.forEach((v, i) => { if (v == null) return; ins[i].value = v; ins[i].dispatchEvent(new Event('input')); ins[i].dispatchEvent(new Event('change')); });
}, [C, box]));

export const SCENES = {
  // ── 02-start ──
  'start-empty': async (h) => {
    // File → New project, confirmed: every layer closed, back to the start screen (reset reopens the demo)
    await h.ev(() => { window._micro.COMMANDS.find((c) => c.id === 'newproj').run(); });
    await h.p.waitForSelector('#pmDlg.show');
    await h.p.click('#pmOk');
    await h.p.waitForFunction(() => !window._micro.layers().length && getComputedStyle(document.querySelector('#empty')).display !== 'none');
    await h.ev(() => { document.querySelector('#meta').textContent = ''; });
    return { blankOk: true, wait: 800 };
  },

  'start-layers-panel': async (h) => {
    await setGroupCollapsed(h, 'mining phases', false);
    await widenPanel(h, 290);
    return {
      clip: await clipOf(h, ['#layersPanel .lp-head', '#lpRows'], 4),
      blankOk: true, wait: 600,
      after: async () => { await setGroupCollapsed(h, 'mining phases', true); await narrowPanel(h); },
    };
  },

  'start-layer-menu': async (h) => {
    // the menu is ~750 px tall and scrolls a little at 900 px: a taller page for this one shot
    await h.p.setViewportSize({ width: 1440, height: 1000 });
    await h.p.waitForTimeout(400);
    const r = await h.p.locator(rowSel('deposit.csv')).first().boundingBox();
    await h.p.mouse.click(r.x + 60, r.y + r.height / 2, { button: 'right' });
    await h.p.waitForSelector('.menu');
    // with Analyse open: the top level and one submenu in the same shot
    await h.p.locator('.menu .item:has-text("Analyse")').first().hover();
    await h.p.waitForFunction(() => document.querySelectorAll('.menu').length >= 2);
    return {
      clip: await clipOf(h, ['#layersPanel .lp-head', '#lpRows', '.menu'], 6), blankOk: true, wait: 500,
      after: async () => { await h.p.keyboard.press('Escape'); await h.p.setViewportSize({ width: 1440, height: 900 }); await h.p.waitForTimeout(400); },
    };
  },

  'start-open-dialog': async (h) => {
    // three files dropped together: a block model CSV, a collar CSV and a PLY mesh (made here)
    await h.ev(() => {
      let bm = 'XC,YC,ZC,FE,SG,LITO\n';
      for (let k = 0; k < 12; k++) for (let j = 0; j < 30; j++) for (let i = 0; i < 40; i++) {
        const x = 612005 + i * 10, y = 7765005 + j * 10, z = 405 + k * 10, fe = 30 + 25 * Math.exp(-(((i - 20) / 9) ** 2 + ((j - 15) / 6) ** 2 + ((k - 6) / 3) ** 2));
        bm += `${x},${y},${z},${fe.toFixed(2)},${(2.6 + fe / 40).toFixed(2)},${fe > 45 ? 'HEMATITE' : 'ITABIRITE'}\n`;
      }
      let col = 'HOLEID,X,Y,Z,EOH\n';
      for (let i = 0; i < 9; i++) col += `RC${String(i + 1).padStart(3, '0')},${612050 + (i % 3) * 150},${7765050 + Math.floor(i / 3) * 100},520,${120 + (i % 4) * 20}\n`;
      const n = 24, V = [], F = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) V.push(`${(612000 + i * 17).toFixed(1)} ${(7765000 + j * 13).toFixed(1)} ${(520 - 60 * Math.exp(-(((i - 12) / 6) ** 2 + ((j - 12) / 6) ** 2))).toFixed(2)}`);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; F.push(`3 ${a} ${a + 1} ${a + n + 2}`, `3 ${a} ${a + n + 2} ${a + n + 1}`); }
      const ply = `ply\nformat ascii 1.0\nelement vertex ${V.length}\nproperty double x\nproperty double y\nproperty double z\nelement face ${F.length}\nproperty list uchar int vertex_indices\nend_header\n${V.join('\n')}\n${F.join('\n')}\n`;
      window._micro.openFilesDialog([new File([bm], 'model.csv'), new File([col], 'collars.csv'), new File([ply], 'pit_shell.ply')]);
    });
    await h.p.waitForFunction(() => document.querySelector('#ofDlg.show') && document.querySelectorAll('#ofDlgBody select').length >= 2, null, { timeout: 20000 });
    await h.p.waitForTimeout(800);
    return { el: '#ofDlg .box', blankOk: true, wait: 600, after: () => h.ev(() => document.querySelector('#ofCancel').click()) };
  },

  'start-palette': async (h) => {
    await h.ev(() => {
      window._micro.openPalette();
      const i = document.querySelector('#palInput'); i.value = 'grade'; i.dispatchEvent(new Event('input'));
    });
    return { el: '#palBox', blankOk: true, wait: 600, after: () => h.ev(() => window._micro.closePalette()) };
  },

  // ── 03-tour ──

  'start-screen-labelled': async (h) => {
    await openDemoGT(h);
    await h.p.mouse.click(720, 462);                     // a block on the cut face → the record panel
    await h.p.waitForSelector('#recPanel.show');
    await placeWin(h, 'grade-tonnage', 690, 74, 460, 320);    // upper right, clear of the compass
    await h.p.waitForTimeout(600);
    await badges(h, [
      { n: 1, sel: '#btnCmd', ax: 0, dx: -5, ay: 0.5 },                 // between Help and ⌘K
      { n: 2, sel: '#filterWrap', ax: 1, dx: 22, ay: 0.5 },
      { n: 3, sel: '#btnSelRect', ax: 0, dx: -64, ay: 0.5 },          // left of the tool buttons, in the gap
      { n: 4, sel: '#budget', ax: 1, dx: 26, ay: 0.5 },
      { n: 5, sel: '#lpRows', ax: 0.5, ay: 0, dy: 280 },
      { n: 6, sel: '#compass', ax: 0, dx: -16, ay: 0 },
      { n: 7, sel: '.fwin', ax: 0, dx: -18, ay: 0, dy: 14 },
      { n: 8, sel: '#recPanel', ax: 0.5, ay: 0, dy: 190 },
      { n: 9, sel: 'footer', ax: 0, dx: 20, ay: 0, dy: -14 },
    ]);
    return { wait: 1500, after: async () => { await clearBadges(h); await restoreView(h); } };
  },

  'tour-pick': async (h) => {
    await press(h, 'l');                                  // face the section
    await h.p.waitForTimeout(900);
    await h.ev(() => { const m = window._micro, s = m.cam.state; s.radius *= 0.3; m.cam.update(); m.requestRender(); });
    await h.p.waitForTimeout(900);
    await h.p.mouse.click(PICK.x, PICK.y);                // a high-grade block on the cut
    await h.p.waitForSelector('#recPanel.show');
    return { wait: 1500, after: () => restoreView(h) };
  },

  'tour-filter': async (h) => {
    await setFilter(h, 'FE > 55');
    await openDemoGT(h);
    await h.ev(() => { const w = [...document.querySelectorAll('.fwin')].pop(); if (w && w._minimize) w._minimize(); });
    await h.ev(() => { const m = window._micro, s = m.cam.state; s.theta = 0.785; s.phi = 1.0; s.radius = 1700; m.cam.update(); m.requestRender(); });
    return { wait: 2000, after: () => restoreView(h) };
  },

  'tour-filter-drawer': async (h) => {
    await setFilter(h, 'FE > 55');
    await h.ev(() => window._micro.toggleFilterDrawer(true));
    await h.ev(() => { const sel = [...document.querySelectorAll('#fdrawer select')].find((x) => [...x.options].some((o) => o.value === 'c:LITO')); sel.value = 'c:LITO'; sel.dispatchEvent(new Event('change')); });
    await h.p.waitForTimeout(800);
    await h.p.locator('#fdrawer .fd-chip:text-is("ITABIRITE")').click();   // the chapter's step: click ITABIRITE
    await h.p.waitForTimeout(800);
    return { clip: { x: 0, y: 0, width: 1440, height: 560 }, wait: 1200, after: () => h.ev(() => window._micro.toggleFilterDrawer(false)) };
  },

  'tour-collars-table': async (h) => {
    await h.p.locator('#lpRows .lp-row.lp-info:has-text("demo_collars")').click();
    await h.p.locator('.menu .item:has-text("Attribute table")').first().click();
    await h.p.waitForSelector('.fwin');
    await h.p.waitForTimeout(800);
    return { el: '.fwin', blankOk: true, wait: 800 };
  },

  'tour-calc-window': async (h) => {
    await addClass(h);
    await h.ev(() => { const m = window._micro; m.openCalcWindow(m.layers().find((x) => x.name === 'deposit.csv'), 0); });
    await placeWin(h, 'calculations', 160, 90, 660, 440);   // tall enough for the buttons under the case table
    return { el: '.fwin', blankOk: true, wait: 1000, after: () => dropClass(h) };
  },

  'tour-class-colored': async (h) => {
    // colored by the ƒ column itself (micro colors a ƒ selection by its values since c7b7c7b9),
    // the calculations window beside the model as the tour leaves it
    await addClass(h);
    await h.p.waitForTimeout(600);
    const v = await colorBy(h, 'ƒ CLASS|^CLASS');
    await h.ev(() => { const m = window._micro; m.openCalcWindow(m.layers().find((x) => x.name === 'deposit.csv'), 0); });
    await placeWin(h, 'calculations', 800, 520, 630, 360);
    await h.p.waitForFunction(() => !/computing/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
    await h.p.waitForTimeout(2500);
    return { wait: 2500, note: v, after: () => dropClass(h) };
  },

  'tour-gt-window': async (h) => {
    await h.ev(() => {
      const m = window._micro; m.openGradeTonnage(m.layers().find((x) => x.name === 'deposit.csv'));
      const w = [...document.querySelectorAll('.fwin')].pop();
      const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); };
      const sels = [...w.querySelectorAll('.sw-ser select.sw-sel, .sw-sel')];
      const unit = [...w.querySelectorAll('select.sw-sel')].find((x) => !x.classList.contains('sw-unit-plot') && [...x.options].some((o) => o.value === 'pct'));
      set(unit, 'pct');
      set(w.querySelector('input.sw-in[placeholder^="density"]'), 'SG');
      set(w.querySelector('.sw-unit-plot'), 'pct');
      w.querySelector('.sw-run').click();
    });
    await h.p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].pop(); return w && w._gtSpec && w._gtSpec.series.length; }, null, { timeout: 60000 });
    await placeWin(h, 'grade-tonnage', 200, 80, 680, 640);   // tall enough that the rail shows scope and ranges
    await h.p.waitForTimeout(600);
    // the window remembers units and density on the layer (L.gtUnits, L.analysis.gt): forget them again
    return { el: '.fwin', blankOk: true, wait: 800, after: () => h.ev(() => { const L = window._micro.layers().find((x) => x.name === 'deposit.csv'); window._micro.closeAllWindows(); delete L.gtUnits; if (L.analysis) delete L.analysis.gt; }) };
  },

  'tour-section-2d': async (h) => {
    await h.ev(() => window._micro.applySection({ mode: 'ew', clip: 'slab', pos: 0.45, half: 5 }));
    await press(h, 'l');
    await h.p.waitForTimeout(600);
    await h.ev(() => { const c = document.querySelector('#sec2D'); c.checked = true; c.dispatchEvent(new Event('input')); });
    await h.p.waitForTimeout(2000);                       // 2D settles (it faces + refits) before the zoom
    await h.p.mouse.move(1000, 480);                      // zoom with the wheel until the slab fills the view
    for (let i = 0; i < 6; i++) { await h.p.mouse.wheel(0, -120); await h.p.waitForTimeout(120); }
    return { wait: 2500 };
  },

  'tour-routine-editor': async (h) => {
    const W = await fillFirstLook(h);
    await placeWin(h, 'routine', 120, 60, 640, 680);
    await h.p.locator(`${W} button:text-is("Preview")`).click();
    await h.p.waitForTimeout(800);
    return { el: W, blankOk: true, wait: 800 };
  },

  'tour-routine-tracker': async (h) => {
    await saveDemoToOpfs(h);
    const W = await fillFirstLook(h);
    await h.p.locator(`${W} button:text-is("Save & Run")`).click();
    await h.p.waitForFunction(() => /2 steps run/.test(document.querySelector('#meta').textContent), null, { timeout: 120000 });
    await h.ev((w) => { const el = document.querySelector(w); if (el) el.style.display = 'none'; }, W);   // the tracker alone
    await placeWin(h, 'routine · first look', 300, 120, 560, 0);
    return { el: '.fwin[data-routine-run]', blankOk: true, wait: 800, after: () => clearSlate(h) };
  },

  'tour-composer': async (h) => {
    // the view to put on the page: the E–W slab, faced, orthographic, filling the view
    await h.ev(() => window._micro.applySection({ mode: 'ew', clip: 'slab', pos: 0.45, half: 5 }));
    await press(h, 'l'); await h.p.waitForTimeout(500);
    await press(h, 'o'); await h.p.waitForTimeout(500);
    await h.ev(() => { const m = window._micro, s = m.cam.state; s.halfH *= 0.42; m.cam.update(); m.requestRender(); });
    await h.p.waitForTimeout(3000);
    await h.ev(() => window._micro.openComposer('figure 1'));
    await h.p.waitForSelector(C);
    for (const b of ['+ 3D view', '+ legend', '+ scale', '+ north', '+ text']) { await h.p.locator(`${C} button:text-is("${b}")`).click(); await h.p.waitForTimeout(600); }
    // + legend gives one per layer that has one (FE twice, "elevation" for the meshes and the
    // topography): keep the model's FE legend, as the chapter's figure does
    for (const id of ['legend-5', 'legend-4', 'legend-3', 'legend-2']) {
      if (!(await h.p.locator(`${C} b.id:text-is("${id}")`).count())) continue;
      await cmpPick(h, id); await h.p.locator(`${C} button:text-is("delete")`).nth(1).click(); await h.p.waitForTimeout(200);
    }
    await cmpPick(h, 'text-1');
    await h.ev((w) => { const ta = document.querySelector(w + ' textarea'); ta.value = ta.value.replace('caption', 'E–W section through the ore lens.'); ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new Event('change')); }, C);
    await cmpBox(h, 'text-1', [12, 134, 196, 10]);
    // the grade–tonnage chart, sent from its window with ⇥ figure
    await h.ev(() => {
      const m = window._micro; m.openGradeTonnage(m.layers().find((x) => x.name === 'deposit.csv'));
      const w = [...document.querySelectorAll('.fwin')].filter((e) => /grade-tonnage/.test(e.querySelector('.t').textContent)).pop();
      const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); };
      set(w.querySelector('input.sw-in[placeholder^="density"]'), 'SG');
      w.querySelector('.sw-run').click();
    });
    await h.p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].filter((e) => /grade-tonnage/.test(e.querySelector('.t').textContent)).pop(); return w && w._gtSpec && w._gtSpec.series.length; }, null, { timeout: 60000 });
    await h.ev(() => { const w = [...document.querySelectorAll('.fwin')].filter((e) => /grade-tonnage/.test(e.querySelector('.t').textContent)).pop(); [...w.querySelectorAll('.awin-btn')].find((b) => /figure/.test(b.textContent)).click(); });
    await h.p.waitForTimeout(1000);
    await h.ev(() => { const w = [...document.querySelectorAll('.fwin')].filter((e) => /grade-tonnage/.test(e.querySelector('.t').textContent)).pop(); if (w) w.querySelector('.fwin-head button:last-child').click(); });
    // ⇥ figure sends the chart and its table: the chart beside the view, the table under the caption
    const ids = await h.ev((w) => [...document.querySelectorAll(w + ' b.id')].map((b) => b.textContent), C);
    const chartId = ids.find((x) => /^plot-/.test(x)), tableId = ids.find((x) => /^table-/.test(x));
    if (chartId) await cmpBox(h, chartId, [214.6, 60, 70, 56]);
    if (tableId) await cmpBox(h, tableId, [12, 146, 196.6, 50]);
    await cmpPick(h, 'view-1');
    // lock the view's scale (inspector → scale 1:) so the slab fills its frame
    await h.ev((w) => { const el = document.querySelector(w), row = [...el.querySelectorAll('.row')].find((r) => r.firstElementChild && r.firstElementChild.textContent.trim() === 'scale'); const i = row && row.querySelector('input'); if (i) { i.value = '12000'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); } }, C);
    await h.p.waitForTimeout(5000);                        // the frame re-renders at its own size; let it converge
    await h.ev((w) => { const el = document.querySelector(w); el.style.left = '20px'; el.style.top = '40px'; el.style.width = '1400px'; el.style.height = '840px'; if (el._onResized) el._onResized(); }, C);
    await h.p.waitForTimeout(800);
    return {
      el: C, blankOk: true, wait: 1500, note: ids.join(' '),
      after: () => h.ev(() => {
        const m = window._micro; m.closeAllWindows();
        const F = m.figures(); for (let i = F.length - 1; i >= 0; i--) if (F[i].name === 'figure 1') F.splice(i, 1);
        if (window._micro.cam.state.ortho) window._micro.cam.setOrtho(false);
        const L = m.layers().find((x) => x.name === 'deposit.csv'); delete L.gtUnits; if (L.analysis) delete L.analysis.gt;
      }),
    };
  },

  'tour-opened': async (h) => {
    await openDemoGT(h);
    return { wait: 2500 };
  },
};
