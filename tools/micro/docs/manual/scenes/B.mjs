// scenes for figures/wanted/B.txt (Part II: Data, chapters 04–09) — see ../scenes.mjs for the contract
//
// In-page helpers are installed once per scene by `setup(h)` as window.__B (layer lookup, row
// context menus, menu clicks, dialog closing, layer visibility with restore).

// a sub-blocked model: 20 m parents, octree-refined to 10 m and then 5 m (power-of-two) where a
// dipping contact passes through them; FE rich below the contact, lean above
function subblockedCsv() {
  let s = 7; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const P = 20, nx = 14, ny = 8, nz = 6, o = 10;
  const X0 = 612400, Y0 = 7765300, Z0 = 500;                  // beside the demo, in its frame
  const contact = (x) => 60 + 0.45 * (x - 140);               // the contact's height, dipping east
  const fe = (x, y, z) => { const d = z - contact(x); return Math.max(8, 38 - 26 * Math.tanh(d / 12) + 4 * Math.sin(y / 30)); };
  let csv = 'XC,YC,ZC,DX,DY,DZ,FE\n';
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const px = o + i * P, py = o + j * P, pz = o + k * P, d = Math.abs(pz - contact(px));
    const sz = d < 12 ? 5 : d < 28 ? 10 : 20;
    const n = P / sz, c0 = [px - P / 2, py - P / 2, pz - P / 2];
    for (let c = 0; c < n; c++) for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const x = c0[0] + (a + 0.5) * sz, y = c0[1] + (b + 0.5) * sz, z = c0[2] + (c + 0.5) * sz;
      csv += `${X0 + x},${Y0 + y},${Z0 + z},${sz},${sz},${sz},${(fe(x, y, z) + (r() - 0.5) * 2).toFixed(2)}\n`;
    }
  }
  return csv;
}

async function setup(h) {
  await h.ev(() => {
    document.querySelector('#help').classList.remove('show');
    // a dialog left open by an earlier scene (the harness reset closes floating windows only)
    for (const el of document.querySelectorAll('[id$="Dlg"].show')) { const x = el.querySelector('.hd button'); if (x) x.click(); el.classList.remove('show'); }
    const m = window._micro;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const B = window.__B = {
      sleep,
      L: (n) => m.layers().find((x) => x.name === n || x.label === n),
      row: (re) => [...document.querySelectorAll('#lpRows .lp-row')].find((x) => re.test(x.textContent)),
      // right-click a layers-panel row → the context menu
      async rowMenu(re) {
        m.toggleLayersPanel(true);
        const r = B.row(re); if (!r) throw new Error('no row ' + re);
        const b = r.getBoundingClientRect();
        r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 60, clientY: b.top + 8 }));
        await sleep(300);
      },
      async menuClick(re) {
        const it = [...document.querySelectorAll('.menu .item')].reverse().find((i) => re.test(i.textContent));
        if (!it) throw new Error('no menu item ' + re + ' in ' + [...document.querySelectorAll('.menu .item')].map((i) => i.textContent).join(' / '));
        it.click(); await sleep(400);
      },
      closeMenus() { document.querySelectorAll('.menu').forEach((x) => x.remove()); },
      closeDlg(id) {
        const el = document.getElementById(id); if (!el || !el.classList.contains('show')) return;
        const x = el.querySelector('.hd button'); if (x) x.click();
        el.classList.remove('show');
      },
      // visibility with a saved copy so the scene can put it back
      saveVis() { B._vis = m.layers().map((L) => [L.id, L.visible]); B._treeVis = JSON.stringify(m.layerTree().filter((x) => typeof x !== 'number').map((g) => g.visible)); },
      show(ids, on) { for (const id of ids) { const L = m.layers().find((x) => x.id === id); if (L) { L.visible = on; m.renderer.setLayerVisible(L.id, on); } } m.applyTreeVisibility(); m.renderLayers(); m.requestRender(); },
      restoreVis() {
        if (!B._vis) return;
        for (const [id, v] of B._vis) { const L = m.layers().find((x) => x.id === id); if (L) { L.visible = v; m.renderer.setLayerVisible(L.id, v); } }
        m.applyTreeVisibility(); m.renderLayers(); m.requestRender(); B._vis = null;
      },
      // the camera + section as the demo opens (restored by applyView of the demo bookmark)
      homeView() { const v = m.views().find((x) => /Ore lens/.test(x.name)); if (v) m.applyView(v); },
      // mesh tint + opacity, remembering the originals for undo()
      _undo: [],
      tint(L, hex) {
        const t0 = L.tint; B._undo.push(() => B.tint1(L, t0));
        B.tint1(L, hex);
      },
      tint1(L, hex) { if (!hex) return; L.tint = hex; const n = parseInt(hex.slice(1), 16); m.renderer.setLayerMeshStyle(L.id, { tint: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }); m.requestRender(); },
      opacity(L, v) { const o0 = L.opacity == null ? 1 : L.opacity; B._undo.push(() => { L.opacity = o0; m.renderer.setLayerOpacity(L.id, o0); }); L.opacity = v; m.renderer.setLayerOpacity(L.id, v); m.requestRender(); },
      // camera + section, saved so the scene can put them back
      saveCam() {
        const c = m.cam.state, $ = (id) => document.getElementById(id);
        // the same fields micro's captureSection() records
        const sec = { mode: $('secMode').value, pos: +$('secPos').value, half: +$('secHalf').value, clip: $('secClip').value, dipDir: +$('secDipDir').value, dip: +$('secDip').value, plane: $('secPlaneVis').checked || undefined };
        const st = { target: [...c.target], radius: c.radius, theta: c.theta, phi: c.phi, ortho: c.ortho, halfH: c.halfH };
        B._undo.push(() => { Object.assign(m.cam.state, st, { target: [...st.target] }); m.cam.update(); if (sec) m.applySection(sec); m.requestRender(); });
      },
      // per-layer "Cut by sections" (the renderer holds it, as the layer menu sets it)
      cut(L, v) { const v0 = m.renderer.layerSectioned(L.id); B._undo.push(() => { m.renderer.setLayerSectioned(L.id, v0); m.requestRender(); }); m.renderer.setLayerSectioned(L.id, v); m.requestRender(); },
      undo() { while (B._undo.length) B._undo.pop()(); B.restoreVis(); m.requestRender(); },
      ids() { return m.layers().map((L) => L.id); },
      async removeNew(before) { for (const L of [...m.layers()]) if (!before.includes(L.id)) await m.confirmRemoveLayer(L.id); },
      async waitFor(fn, ms = 30000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(100); } },
    };
  });
}

export const SCENES = {
  // ── 04-opening ──
  // The files are the demo's own (the same generators the demo project uses), named as a saved
  // project names them, handed to the open dialog together — as File → Open… would.
  'open-dialog': async (h) => {
    await setup(h);
    await h.ev(async () => {
      const m = window._micro, B = window.__B, d = m.makeDemoDrillholes();
      const shell = B.L('ore shell').docs.meshDoc.blob;
      await m.openFilesDialog([new File([m.makeDemoBlockCsv()], 'deposit.csv'), d.collar, d.survey, d.intervals, new File([shell], 'ore_shell.obj')]);
    });
    await h.p.waitForFunction(() => document.querySelector('#ofDlg.show') && document.querySelectorAll('#ofDlgBody select').length >= 3, null, { timeout: 30000 });
    return { el: '#ofDlg .box', blankOk: true, wait: 800 };
  },
  'open-fileinfo': async (h) => {
    await setup(h);
    await h.ev(() => window._micro.setActiveLayer(window.__B.L('deposit.csv').id));
    await h.p.keyboard.press('i');
    await h.p.waitForTimeout(500);
    return { el: '#help .box', blankOk: true, after: () => h.ev(() => document.querySelector('#help').classList.remove('show')) };
  },

  // ── 05-blocks ──
  'blocks-subblocked': async (h) => {
    await setup(h);
    await h.ev(async (csv) => {
      const m = window._micro, B = window.__B, before = B.ids();
      B._sbBefore = before; B.saveVis();
      let e0 = null; try { e0 = localStorage.getItem('micro.edges'); } catch {}
      B._edges0 = e0;
      B.show(before, false);
      const id = await m.openBlob(new Blob([csv]), 'subblocked.csv', 'add');
      await B.waitFor(() => { const L = m.layers().find((x) => x.name === 'subblocked.csv'); return L && m.renderer.layerElementCount(L.id) > 0; }, 60000);
      const L = m.layers().find((x) => x.name === 'subblocked.csv'); m.setActiveLayer(L.id);
      const cb = document.querySelector('#colorBy'); const o = [...cb.options].find((x) => /FE/.test(x.textContent) && x.value.startsWith('chan:'));
      if (o) { cb.value = o.value; cb.dispatchEvent(new Event('change')); }
      m.setBlockEdges(true);
      const e = document.querySelector('#secMode'); e.value = 'off'; e.dispatchEvent(new Event('input'));
      await B.rowMenu(/^subblocked\.csv/); await B.menuClick(/^Zoom to layer/);
      m.cam.orbit(-2.0, -0.1); m.cam.dolly(0.95); m.requestRender();
      await B.sleep(500);
    }, subblockedCsv());
    return { wait: 2500, after: () => h.ev(async () => { const m = window._micro, B = window.__B; await B.removeNew(B._sbBefore); m.setBlockEdges(B._edges0 === '1'); B.restoreVis(); }) };
  },

  'blocks-store-parquet': async (h) => {
    await setup(h);
    await h.ev(async () => { const B = window.__B; await B.rowMenu(/^deposit\.csv/); await B.menuClick(/^Data & file/); await B.menuClick(/^Store as Parquet/); });
    return { el: '#opDlg .box', blankOk: true };
  },

  // ── 09-columns ──
  'columns-tab': async (h) => {
    await setup(h);
    await h.ev(async () => {
      const m = window._micro, B = window.__B;
      m.setActiveLayer(B.L('deposit.csv').id); m.openProps();
      const pp = document.querySelector('#propPanel'); B._ppW = pp.style.width; pp.style.width = '440px';   // room for the stats lines
      [...document.querySelectorAll('#ppTabs .pp-tab')].find((b) => b.textContent === 'columns').click();
      await B.sleep(300);
      const sc = [...document.querySelectorAll('#ppBody button')].find((b) => /scan columns/.test(b.textContent));
      if (sc) {
        sc.click(); await B.sleep(500);
        await B.waitFor(() => !/scanning/.test(document.querySelector('#ppBody').textContent), 90000);
      }
      await B.sleep(800);
    });
    return { el: '#propPanel', blankOk: true, after: () => h.ev(() => { document.querySelector('#propPanel').style.width = window.__B._ppW || ''; document.querySelector('#ppClose').click(); }) };
  },

  'blocks-shell': async (h) => {
    await setup(h);
    await h.ev(async () => {
      const m = window._micro, B = window.__B, before = B.ids();
      B._shellBefore = before;
      B.saveVis();
      m.openGradeShell(B.L('deposit.csv'));
      const w = [...document.querySelectorAll('.fwin')].pop();
      const sel = w.querySelectorAll('select.sw-sel');
      sel[0].value = 'FE'; sel[0].dispatchEvent(new Event('change'));
      const cut = w.querySelector('input.sw-in'); cut.value = '60'; cut.dispatchEvent(new Event('input'));
      const sm = [...sel].find((s) => [...s.options].some((o) => o.text === 'light')); sm.value = '1'; sm.dispatchEvent(new Event('change'));
      [...w.querySelectorAll('button')].find((b) => b.textContent === 'Make shell').click();
      await B.waitFor(() => /triangles around/.test(w.textContent) || m.layers().length > before.length, 120000);
      await B.waitFor(() => m.layers().length > before.length, 30000);
      m.closeAllWindows();
      B.show([B.L('deposit.csv').id, B.L('topography').id, B.L('ore shell').id, ...['phase 1 — starter pit', 'phase 2 — cutback', 'phase 3 — final pit'].map((n) => B.L(n).id)], false);
      const e = document.querySelector('#secMode'); e.value = 'off'; e.dispatchEvent(new Event('input'));
      document.querySelector('#btnFit').click(); m.cam.dolly(0.5); m.requestRender();
      await B.sleep(500);
    });
    return { wait: 2500, after: () => h.ev(async () => { const B = window.__B; await B.removeNew(B._shellBefore); B.restoreVis(); }) };
  },

  // ── 09-columns (attribute table) ──
  'attr-table': async (h) => {
    await setup(h);
    const pt = await h.ev(async () => {
      const m = window._micro, B = window.__B, L = B.L('deposit.csv');
      m.setActiveLayer(L.id);
      // the request said LITO = "HEMATITE", but the demo's rich core is ITABIRITE (HEMATITE ∧ FE > 64 is empty)
      // the new demo: HEMATITE is the high-grade core (FE > 64 ∧ HEMATITE = 1,885 blocks)
      const e = 'FE > 64 and LITO = "HEMATITE"';
      document.querySelector('#filter').value = e; await m.applyBlockFilter(e);
      m.cam.dolly(0.4); m.requestRender();                       // the kept core is small: come closer
      m.openAttrTable(L);
      const t = m.attrTables.get(L.id), w = t.win.el;
      w.style.left = '236px'; w.style.top = '540px'; w.style.width = '700px'; w.style.height = '320px'; if (w._onResized) w._onResized();
      const oc = [...w.querySelectorAll('label')].find((l) => l.textContent.trim() === 'matches').querySelector('input');
      oc.checked = true; oc.dispatchEvent(new Event('change'));
      await B.sleep(600);
      const body = w.querySelector('canvas').getBoundingClientRect();
      return { x: body.left + 64 + 60, y: body.top + 22 + 22 * 4 + 11 };   // the 5th row
    });
    await h.p.mouse.click(pt.x, pt.y);
    return { wait: 2000 };
  },

  // ── 06-drillholes ──
  'dh-set-panel': async (h) => {
    await setup(h);
    const clip = await h.ev(() => {
      window._micro.toggleLayersPanel(true);
      // wide enough that the set's file names aren't cut; put back shortly after the capture
      const lp = document.querySelector('#layersPanel'), w0 = lp.style.width;
      lp.style.width = '300px'; setTimeout(() => { lp.style.width = w0; window.dispatchEvent(new Event('resize')); }, 3000);
      window.dispatchEvent(new Event('resize'));
      const p = document.querySelector('#layersPanel').getBoundingClientRect(), rows = [...document.querySelectorAll('#lpRows .lp-row')];
      const last = rows[rows.length - 1].getBoundingClientRect();
      return { x: p.left, y: p.top, width: p.width, height: last.bottom - p.top + 10 };
    });
    return { clip, blankOk: true, wait: 500 };
  },

  'dh-hole-filter': async (h) => {
    await setup(h);
    await h.ev(async () => {
      const m = window._micro, B = window.__B, dh = B.L('demo_assay.csv');
      const nd = m.layerTree().find((x) => typeof x !== 'number' && x.dhSet);
      B.saveVis();
      await m.showHoleTraces(nd);                                   // Show hole traces on the set …
      await m.setHoleFilter(nd, 'COMPANY = "MERIDIAN"');            // … then ◈ collars → Filter holes… (traces follow)
      B.show([B.L('deposit.csv').id, B.L('topography').id, B.L('phase 1 — starter pit').id, B.L('ore shell').id], false);
      m.setActiveLayer(dh.id);
      B._undo.push(async () => { await m.setHoleFilter(nd, ''); if (m.layers().some((L) => L.trace)) await m.showHoleTraces(nd); });
      m.cam.dolly(0.62); m.requestRender();                       // close enough that the kept holes read
      await B.sleep(300);
    });
    return { wait: 2000, after: () => h.ev(async () => { const B = window.__B; while (B._undo.length) await B._undo.pop()(); B.restoreVis(); }) };
  },

  'dh-composite-window': async (h) => {
    await setup(h);
    await h.ev(async () => {
      const m = window._micro, B = window.__B, before = B.ids();
      m.openComposite(B.L('demo_assay.csv'));
      const w = [...document.querySelectorAll('.fwin')].pop();
      const len = w.querySelector('input.sw-in'); len.value = '5'; len.dispatchEvent(new Event('input'));
      [...w.querySelectorAll('button')].find((b) => b.textContent === 'Composite').click();
      await B.waitFor(() => /composites of/.test(w.textContent));
      await B.removeNew(before);                 // the composites layer goes; the window keeps its report
      m.setActiveLayer(B.L('deposit.csv').id);
    });
    return { el: '.fwin >> nth=-1', blankOk: true };
  },

  // ── 07-meshes ──
  'meshes-export-dialog': async (h) => {
    await setup(h);
    await h.ev(async () => { const B = window.__B; await B.rowMenu(/^▸?\s*mining phases/); await B.menuClick(/^Export 3 meshes/);
      const sel = document.querySelector('#meDlgBody select'); sel.value = 'lfm'; sel.dispatchEvent(new Event('input')); });
    return { el: '#meDlg .box', blankOk: true };
  },

  'meshes-demo': async (h) => {
    await setup(h);
    await h.ev(async () => {
      const m = window._micro, B = window.__B;
      B.saveVis();
      // a FOLLOWING mesh draws only its trace, so the shell is set to "don't cut" for its tint +
      // opacity to show; phase 1 keeps following (its trace on the cut face)
      B.cut(B.L('ore shell'), false);
      B.tint(B.L('ore shell'), '#5c8a5a'); B.opacity(B.L('ore shell'), 0.5);
      B.show([B.L('topography').id], false); B.show([B.L('phase 1 — starter pit').id], true);
      B.saveCam(); m.cam.dolly(0.5); m.requestRender();
    });
    return { wait: 2500, after: () => h.ev(() => window.__B.undo()) };
  },

  // ── 08-grids ──
  'grids-relief': async (h) => {
    await setup(h);
    await h.ev(async () => {
      const m = window._micro, B = window.__B;
      B.saveVis(); B.saveCam();
      B.show([B.L('topography').id, B.L('phase 3 — final pit').id], true);
      B.show([B.L('phase 1 — starter pit').id], false);
      // a FOLLOWING mesh draws only its trace while the section keeps one side, so the surfaces
      // are set to "don't cut" to read as relief over the cut model
      B.cut(B.L('topography'), false); B.cut(B.L('phase 3 — final pit'), false);
      m.setZExag(1); m.applySection({ mode: 'ew', clip: 'behind', pos: 0.45 });
      m.cam.orbit(-Math.PI / 2, -0.08); m.cam.fit(m.docBbox()); m.cam.dolly(0.75); m.requestRender();     // from the south-east, a little lower
    });
    return { wait: 2500, after: () => h.ev(() => window.__B.undo()) };
  },
  'grids-surface-tools': async (h) => {
    await setup(h);
    await h.ev(() => window._micro.openSurfaceTools('extend', window.__B.L('topography')));
    return { el: '#sfDlg .box', blankOk: true };
  },
  'grids-new-dialog': async (h) => {
    await setup(h);
    await h.ev(async () => {
      const B = window.__B, body = () => document.querySelector('#ngDlgBody');
      window._micro.openNewDialog();
      const radio = (lab) => [...body().querySelectorAll('label')].find((l) => l.textContent.trim() === lab).querySelector('input');
      radio('block model').click(); radio('block model').dispatchEvent(new Event('change')); await B.sleep(100);
      const bRow = (lab) => [...body().querySelectorAll('.ex-row')].find((r) => r.querySelector('b').textContent === lab);
      const src = bRow('source').querySelector('select');
      src.value = 'L' + B.L('deposit.csv').id; src.dispatchEvent(new Event('change'));
      const al = bRow('align').querySelector('input[type=checkbox]'); al.checked = true; al.dispatchEvent(new Event('change')); await B.sleep(100);
      const set = (inp, v) => { inp.value = String(v); inp.dispatchEvent(new Event('input')); };
      const ap = bRow('align').querySelectorAll('input[type=number]');
      set(ap[0], 612000); set(ap[1], 7765000); set(ap[2], 400);
      const bk = bRow('block (m)').querySelectorAll('input');
      set(bk[0], 50); set(bk[1], 50); set(bk[2], 20);
      // re-render once so the align note reads the typed point (the dialog keeps its values)
      for (const on of [false, true]) { const c = bRow('align').querySelector('input[type=checkbox]'); c.checked = on; c.dispatchEvent(new Event('change')); await B.sleep(50); }
    });
    return { el: '#ngDlg .box', blankOk: true };
  },
};
