// scenes for figures/wanted/E.txt (Part IV second half: joins, geometry, QA, structure; Part V:
// figures, composer, atlas) — see ../scenes.mjs for the contract

const place = (h, re, x, y, w, ht) => h.ev(([src, x2, y2, w2, h2]) => {
  const el = [...document.querySelectorAll('.fwin')].find((e) => new RegExp(src, 'i').test(e.querySelector('.t').textContent));
  if (!el) return false;
  el.style.left = x2 + 'px'; el.style.top = y2 + 'px'; if (w2) el.style.width = w2 + 'px'; if (h2) el.style.height = h2 + 'px';
  if (el._onResized) el._onResized();
  return true;
}, [re, x, y, w, ht]);
const closeAll = (h) => h.ev(() => window._micro.closeAllWindows());
const removeLayers = (h, ids) => h.ev((xs) => { for (const id of xs) try { window.micro.removeLayer(id); } catch {} }, ids);

// ── QA: data with known faults, built from the demo's own files ──

// the demo model with problems: −99 sentinels, one block twice, a zero density, blocks gone mid-column
async function faultyModel(h) {
  return h.ev(async () => {
    const m = window._micro;
    const lines = (await m.makeDemoBlockCsv().text()).split('\n');
    const out = [lines[0]];
    let fe99 = 0, sg0 = 0, dup = null;
    for (let i = 1; i < lines.length; i++) {
      const s = lines[i]; if (!s) continue;
      const c = s.split(',');
      const x = +c[0], y = +c[1], z = +c[2];
      // a column in the middle of the deposit, three blocks gone halfway down
      if (x === 613000 && y === 7765450 && z >= 640 && z < 655) continue;
      if (x === 613200 && y === 7765400 && z >= 600 && z < 610) continue;
      if (fe99 < 4 && z === 700 && (x - 612000) % 370 === 0 && y === 7765500) { c[3] = '-99'; fe99++; }
      if (!sg0 && x === 612800 && y === 7765300 && z === 620) { c[4] = '0'; sg0++; }
      if (!dup && x === 613500 && y === 7765600 && z === 650) dup = c.join(',');
      out.push(c.join(','));
    }
    if (dup) out.push(dup);
    const id = await m.openBlob(new File([out.join('\n') + '\n'], 'deposit_draft.csv'), 'deposit_draft.csv', 'add');
    return id;
  });
}

// ── structure: the demo's final-pit surface with three sets painted on its walls ──
// patches are chosen by geometry (vertices near a point on the wall), painted with the
// app's own paintApply, so the window measures them exactly as wand strokes
async function structureSetup(h) {
  const st = await h.ev(async () => {
    const m = window._micro, L = m.layers().find((q) => q.label === 'phase 3 — final pit');
    const vis = m.layers().map((q) => [q.id, q.visible !== false]);
    for (const q of m.layers()) if (q.id !== L.id) window.micro.setVisible(q.id, false);
    window.micro.setVisible(L.id, true);
    m.applySection({ mode: 'off' });
    await m.openStructure(L);
    for (let n = 0; n < 400 && !(L.paintCols || []).some((c) => c.name === 'SET'); n++) await new Promise((q) => setTimeout(q, 50));
    const w = [...document.querySelectorAll('.fwin')].find((e) => /^structure ·/.test(e.querySelector('.t').textContent));
    const btn = (re) => [...w.querySelectorAll('button')].find((b) => re.test(b.textContent));
    btn(/^\+ set$/).click(); await new Promise((q) => setTimeout(q, 50));
    btn(/^\+ set$/).click(); await new Promise((q) => setTimeout(q, 50));
    const col = L.paintCols.find((c) => c.name === 'SET');
    const md = await m.meshVertexData(L), V = md.vertices, nv = V.length / 3;
    const cx = 613000, cy = 7765450, rx = 430, ry = 215;
    const near = (az, f, rad) => {            // vertices within rad of the wall point at azimuth az (deg from north), f × the wall radius
      const a = az * Math.PI / 180, px = cx + Math.sin(a) * rx * f, py = cy + Math.cos(a) * ry * f, out = [];
      for (let i = 0; i < nv; i++) if (Math.hypot(V[3 * i] - px, V[3 * i + 1] - py) < rad && V[3 * i + 2] > 0) out.push(i);
      return out;
    };
    const code = (nm) => col.dict.indexOf(nm);
    const sets = { J1: [[-12, 1, 55], [10, 1.05, 50], [30, 0.95, 50]], J2: [[66, 1, 50], [114, 0.95, 50]], J3: [[190, 1, 55], [215, 1.05, 50]] };
    for (const [nm, ps] of Object.entries(sets)) for (const [az, f, rad] of ps) m.paintApply(L, col, near(az, f, rad), code(nm));
    // a long, narrow patch down the east wall — one row of vertices across the steepest part, and two
    // from the next row so it is a surface at all: strike sure, dip not
    const strip = [];
    for (let i = 0; i < nv; i++) {
      const x = V[3 * i], y = V[3 * i + 1];
      if (Math.abs(y - cy) < 1 && x >= cx + 300 && x <= cx + 560) strip.push(i);
      if (Math.abs(y - (cy - 20)) < 1 && (Math.abs(x - (cx + 420)) < 1 || Math.abs(x - (cx + 440)) < 1)) strip.push(i);
    }
    m.paintApply(L, col, strip, code('J2'));
    await new Promise((q) => setTimeout(q, 400));
    btn(/▸ paint/).click();
    return { lid: L.id, vis };
  });
  await h.p.waitForTimeout(500);
  return st;
}
async function structureUndo(h, st) {
  await h.ev(({ lid, vis }) => {
    const m = window._micro, L = m.layers().find((q) => q.id === lid);
    try { const w = [...document.querySelectorAll('.fwin')].find((e) => /^structure ·/.test(e.querySelector('.t').textContent)); const b = w && [...w.querySelectorAll('button')].find((x) => /stop/.test(x.textContent)); if (b) b.click(); } catch {}
    m.closeAllWindows();
    for (const D of m.layers().filter((q) => q.derivedOf === lid)) try { window.micro.removeLayer(D.id); } catch {}
    if (L) { L.paintCols = (L.paintCols || []).filter((c) => c.name !== 'SET'); L._structView = null; L._colStats = null; L._paintUndo = []; L.vertexColored = false; }
    for (const [id, on] of vis) { const q = m.layers().find((x) => x.id === id); if (q) q.visible = on; }
    m.applyTreeVisibility(); m.renderLayers(); m.requestRender();
  }, st);
}
const structCam = (h) => h.ev(() => {
  const m = window._micro, L = m.layers().find((q) => q.label === 'phase 3 — final pit');
  window.micro.fit(L.id);
  const s = m.cam.state; s.theta = -Math.PI / 2 - 0.35; s.phi = 0.95; s.radius *= 0.8; s.target = [s.target[0] + 0.18 * s.radius, s.target[1], s.target[2]]; m.cam.update(); m.requestRender();
});

// ── figures: decorations on/off, background, as the panel sets them ──
const decoOn = (h, title, bg) => h.ev(([t, b]) => {
  const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
  const prev = { bg: (() => { try { return localStorage.getItem('micro.scene') || 'auto'; } catch { return 'auto'; } })() };
  m.setDeco('scale', true); m.setDeco('north', true); m.setDecoTitle(t); m.setLayerLegend(L, true); m.setBg(b);
  return prev;
}, [title, bg]);
const decoOff = (h, prev) => h.ev((pv) => {
  const m = window._micro;
  m.setDeco('scale', false); m.setDeco('north', false); m.setDecoTitle('');
  for (const L of m.layers()) if (L.legend) m.setLayerLegend(L, false);
  m.setBg(pv && pv.bg ? pv.bg : 'auto');
}, prev);

// ── composer: a figure on the demo, built with the composer's own buttons and functions ──
// a scene names its figure uniquely and deletes it after; layers it hides come back
const tb = (h, label) => h.ev((l) => { const b = [...document.querySelectorAll('.composer-win button')].find((x) => x.textContent.trim() === l); if (!b) throw new Error('no composer button ' + l); b.click(); }, label);
const compoZoom = (h, v) => h.ev((z) => { const s = [...document.querySelectorAll('.composer-win select')].find((x) => x.title === 'zoom'); s.value = z; s.dispatchEvent(new Event('change')); }, v);
async function compoStart(h, name, { hide = ['topography'], section = { axis: 'z', position: 640, thickness: 10 }, view = { look: 0, elevation: 90, ortho: true } } = {}) {
  const st = await h.ev(async ([nm, hd, sec, vw]) => {
    const m = window._micro, vis = m.layers().map((q) => [q.id, q.visible !== false]);
    const bg = (() => { try { return localStorage.getItem('micro.scene') || 'auto'; } catch { return 'auto'; } })();
    for (const q of m.layers()) if (hd.includes(q.label || q.name)) window.micro.setVisible(q.id, false);
    if (vw) await window.micro.setView(vw);
    if (sec) await window.micro.setSection(sec);
    if (vw) { window.micro.fit(m.layers().find((x) => x.name === 'deposit.csv').id); m.cam.dolly(0.52); }
    m.setBg('#ffffff');
    m.closeAllWindows();
    return { name: nm, vis, bg };
  }, [name, hide, section, view]);
  await h.p.waitForTimeout(800);
  await h.ev((nm) => {
    const m = window._micro; m.openComposer(nm);
    const w = document.querySelector('.composer-win'); w.style.left = '10px'; w.style.top = '58px'; w.style.width = '1420px'; w.style.height = '835px'; if (w._onResized) w._onResized();
  }, name);
  await h.p.waitForTimeout(400);
  return st;
}
async function compoEnd(h, st) {
  await h.ev(async (s2) => {
    const m = window._micro;
    m.closeAllWindows();
    const figs = m.figures(); for (let i = figs.length - 1; i >= 0; i--) if (figs[i].name === s2.name || (s2.extra || []).includes(figs[i].name)) figs.splice(i, 1);
    try { m.setHouseProps({}); } catch {}
    document.querySelector('#filter').value = ''; try { await m.applyBlockFilter(''); } catch {}
    for (const [id, on] of s2.vis) { const q = m.layers().find((x) => x.id === id); if (q) q.visible = on; }
    m.applyTreeVisibility(); m.renderLayers();
    try { await window.micro.setSection(null); } catch {}
    m.cam.setOrtho(false); m.setBg(s2.bg || 'auto'); m.requestRender();
  }, st);
}
// the plan figure: view (left), its legend, scale and north, a caption, and the GT chart + table at the right
async function compoPlanFigure(h, caption) {
  const ids = await h.ev((cap) => {
    const m = window._micro, ed = m.composerEditor();
    const vf = m.addViewFrame(ed, { box: [12, 14, 168, 118] });
    return { vf: vf.id };
  }, caption);
  await h.ev((id) => { const ed = window._micro.composerEditor(); ed.select([id]); }, ids.vf);
  await tb(h, '+ legend'); await tb(h, '+ scale'); await tb(h, '+ north');
  await h.ev(([id, cap]) => {
    const ed = window._micro.composerEditor(), d = ed.getDoc();
    ed.addFrame({ kind: 'text', box: [12, 143, 168, 12], content: { md: cap, size: 9 } });
    // one legend: the model's (the drillholes' and the meshes' go)
    const legs = d.frames.filter((f) => f.kind === 'legend');
    const keep = legs.find((f) => f.source.layer === 'deposit.csv');
    if (keep) ed.update(keep.id, (fr) => { fr.box = [186, 14, 28, 44]; });
    ed.select(legs.filter((f) => f !== keep).map((f) => f.id));
    [...document.querySelectorAll('.composer-win button')].find((b) => /delete the selected frames/.test(b.title)).click();
  }, [ids.vf, caption]);
  // the grade–tonnage window → ⇥ figure: its chart and table land on the page
  await h.ev(() => {
    const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
    m.openGradeTonnage(L, { cfg: { series: [{ layer: 'deposit.csv', col: 'FE', unit: 'pct', weight: 'SG', filter: '' }], nCut: 8, scope: 'all', gradeUnit: 'pct', densUnit: 't/m3' }, run: true });
  });
  await h.p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /grade-tonnage/.test(e.querySelector('.t').textContent)); return w && w._gtSpec; }, null, { timeout: 60000 });
  await h.p.waitForTimeout(500);
  await h.ev(() => {
    const w = [...document.querySelectorAll('.fwin')].find((e) => /grade-tonnage/.test(e.querySelector('.t').textContent));
    [...w.querySelectorAll('button')].find((b) => b.textContent === '⇥ figure').click();
    w.querySelector('.fwin-head button:last-child').click();
  });
  await h.p.waitForTimeout(500);
  await h.ev(() => {
    const ed = window._micro.composerEditor(), d = ed.getDoc();
    for (const f of d.frames) {
      if (f.kind === 'chart') ed.update(f.id, (fr) => { fr.box = [216, 14, 69, 56]; });
      if (f.kind === 'table') ed.update(f.id, (fr) => { fr.box = [186, 76, 99, fr.box[3]]; });
    }
  });
  return ids;
}

// the page region round a frame (after scrolling the desk to it), clipped to the visible desk
const frameClip = (h, id, mg = 24) => h.ev(([fid, g]) => {
  const fr = [...document.querySelectorAll('.composer-win .compo-fr')].find((x) => x.dataset.id === fid);
  fr.scrollIntoView({ block: 'center', inline: 'center' });
  const r = fr.getBoundingClientRect(), side = document.querySelector('.composer-win .compo-side').getBoundingClientRect();
  const bar = [...document.querySelectorAll('.composer-win .compo-bar')].pop().getBoundingClientRect();
  const x = Math.max(r.left - g, 0), y = Math.max(r.top - g, bar.bottom + 1);
  return { x, y, width: Math.min(r.right + g, side.left) - x, height: Math.min(r.bottom + g, innerHeight) - y };
}, [id, mg]);

// the composer page (the sheet itself), nothing selected
const pageClip = (h) => h.ev(() => {
  window._micro.composerEditor().select([]);
  const r = document.querySelector('.composer-win .compo-pagewrap').getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
});

export const SCENES = {
  'qa-model': async (h) => {
    const id = await faultyModel(h);
    await h.ev(async (lid) => {
      const m = window._micro, L = m.layers().find((q) => q.id === lid);
      m.setActiveLayer(L.id);
      const e = await m.openModelQa(L); await e.done;
    }, id);
    await place(h, '^model QA', 300, 80, 840, 400);
    await h.p.waitForTimeout(600);
    return { el: h.win('^model QA'), blankOk: true, after: async () => { await closeAll(h); await removeLayers(h, [id]); } };
  },

  'qa-dh': async (h) => {
    const id = await h.ev(async () => {
      const m = window._micro, f = m.makeDemoDrillholes();
      const tx = async (b) => (await b.text()).trim().split('\n');
      const col = await tx(f.collar), sur = await tx(f.survey), asy = await tx(f.intervals);
      // the ch22 exercise: DH005's 40–45 m interval edited to start at 38 (an overlap), and
      // DH012's collar row deleted (its surveys and intervals are orphans)
      const i5 = asy.findIndex((l) => l.startsWith('DH005,40,'));
      if (i5 > 0) asy[i5] = 'DH005,38,' + asy[i5].split(',').slice(2).join(',');
      const ic = col.findIndex((l) => l.startsWith('DH012,'));
      if (ic > 0) col.splice(ic, 1);
      const F = (a, n) => new File([a.join('\n') + '\n'], n, { type: 'text/csv' });
      return m.importDrillholes({ collar: F(col, 'broken_collars.csv'), survey: F(sur, 'broken_survey.csv'), intervals: F(asy, 'broken_assay.csv') }, { radius: 6 }, 'add');
    });
    await h.ev(async (lid) => {
      const m = window._micro;
      const g = m.dhSetGroupOf(lid);
      const hq = await m.openDhQa(g || m.layers().find((q) => q.id === lid));
      for (let n = 0; n < 300 && (!hq.state.r || hq.state.running); n++) await new Promise((q) => setTimeout(q, 50));
    }, id);
    await place(h, '^drillhole QA', 300, 90, 900, 520);
    await h.p.waitForTimeout(600);
    return { el: h.win('^drillhole QA'), blankOk: true, after: async () => { await closeAll(h); await removeLayers(h, [id]); } };
  },

  'qa-mesh': async (h) => {
    const id = await h.ev(async () => {
      const M = window._micro;
      const o = M.frame.origin, bb = M.docBbox();
      const cx = (bb[0] + bb[3]) / 2 + o[0], cy = (bb[1] + bb[4]) / 2 + o[1], cz = (bb[2] + bb[5]) / 2 + o[2];
      const [x0, y0, z0, x1, y1, z1] = [cx - 150, cy - 100, cz - 60, cx + 150, cy + 100, cz + 60];
      const V = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
      const T = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
      return M.addLayer({ kind: 'mesh', name: 'stope box', vertices: Float64Array.from(V), triangles: Uint32Array.from(T.slice(3)) });
    });
    await h.ev(async (lid) => {
      const M = window._micro, L = M.layers().find((q) => q.id === lid);
      const hb = await M.openMeshQa(L);
      for (let n = 0; n < 200 && !hb.win.el._meshQa; n++) await new Promise((q) => setTimeout(q, 50));
      const tr = [...hb.win.el.querySelectorAll('.mq-tbl tr')].find((r) => /boundary/i.test(r.textContent)) || hb.win.el.querySelector('.mq-tbl tr:nth-child(2)');
      tr.click();
    }, id);
    await place(h, '^mesh QA', 300, 100, 800, 390);
    await h.p.waitForTimeout(800);
    return { el: h.win('^mesh QA'), after: async () => { await closeAll(h); await removeLayers(h, [id]); } };
  },
  'geometry-dialog': async (h) => {
    await h.ev(async () => {
      const m = window._micro, sh = m.layers().find((L) => L.label === 'ore shell');
      m.openSolidDialog(sh);
      for (let n = 0; n < 200 && !/closed solid/.test(document.querySelector('#sbDlgBody').textContent); n++) await new Promise((q) => setTimeout(q, 50));
      const lab = [...document.querySelectorAll('#sbDlgBody label')].find((l) => l.textContent === 'fraction column');
      lab.querySelector('input').click();
      const row = [...document.querySelectorAll('#sbDlgBody .ex-row')].find((r) => r.querySelector('b') && r.querySelector('b').textContent === 'probes');
      const ins = row.querySelectorAll('input');
      ins[2].value = '2'; ins[2].dispatchEvent(new Event('input'));
      const nm = [...document.querySelectorAll('#sbDlgBody .ex-row')].find((r) => r.querySelector('b') && r.querySelector('b').textContent === 'column').querySelector('input');
      nm.value = 'ORE_FRAC'; nm.dispatchEvent(new Event('change'));
    });
    await h.p.mouse.move(1300, 850);
    const clip = await h.ev(() => {
      const r = document.querySelector('#sbDlg .box').getBoundingClientRect(), mg = 60;
      const x = Math.max(0, r.left - mg), y = Math.max(0, r.top - mg);
      return { x, y, width: Math.min(innerWidth, r.right + mg) - x, height: Math.min(innerHeight, r.bottom + mg) - y };
    });
    return { clip, after: () => h.ev(() => { const x = document.querySelector('#sbCancel'); if (x) x.click(); }) };
  },
  'joins-reconcile': async (h) => {
    const vis = await h.ev(() => window._micro.layers().map((L) => [L.id, L.visible !== false]));
    // the newer estimate: FE shifted low at the north end, high at the south, about zero on average
    const v2 = await h.ev(async () => {
      const m = window._micro, lines = (await m.makeDemoBlockCsv().text()).split('\n'), out = [lines[0]];
      const y0 = 7765000, y1 = 7765990, ym = (y0 + y1) / 2;
      for (let i = 1; i < lines.length; i++) {
        const s = lines[i]; if (!s) continue;
        const c = s.split(','), t = (+c[1] - ym) / ((y1 - y0) / 2);
        c[3] = Math.max(0, +c[3] - 4 * t).toFixed(2);
        out.push(c.join(','));
      }
      return m.openBlob(new File([out.join('\n') + '\n'], 'deposit_v2.csv'), 'deposit_v2.csv', 'add');
    });
    // Properties → join on the newer one, right = the older, Reconcile… → Δ on FE
    await h.ev(async (id) => {
      const m = window._micro, ref = m.layers().find((L) => L.name === 'deposit.csv');
      m.setActiveLayer(id); m.openProps();
      [...document.querySelectorAll('#ppTabs .pp-tab')].find((x) => x.textContent.trim() === 'join').click();
      const rs = [...document.querySelectorAll('#propPanel .pp-row')].find((r) => /^\s*right/.test(r.textContent)).querySelector('select');
      rs.value = String(ref.id); rs.dispatchEvent(new Event('change'));
    }, v2);
    await h.p.waitForTimeout(400);
    await h.ev(() => [...document.querySelectorAll('#propPanel button')].find((b) => b.textContent === 'Reconcile…').click());
    await h.p.waitForTimeout(300);
    await h.ev(() => [...document.querySelectorAll('.menu *')].find((e) => e.textContent.trim() === 'Δ on FE' && !e.children.length).click());
    await h.p.waitForFunction(() => window._micro.layers().some((L) => /^reconcile_/.test(L.name) && L._reconcile), null, { timeout: 120000 });
    const rid = await h.ev((id) => {
      const m = window._micro, J = m.layers().find((L) => /^reconcile_/.test(L.name));
      const lim = +(2 * J._reconcile.meanAbsDelta).toPrecision(2);
      for (const L of m.layers()) if (L.id !== J.id) window.micro.setVisible(L.id, false);
      window.micro.setVisible(J.id, true);
      m.setActiveLayer(J.id);
      window.micro.setColorRange(J.id, { min: -lim, max: lim });
      m.applySection({ mode: 'off' });
      document.querySelector('#compass').dispatchEvent(new MouseEvent('click'));   // plan, north up
      window.micro.fit(J.id);
      // back to the newer model's join tab (switching layers resets the form), right = the older
      m.setActiveLayer(id); m.openProps();
      [...document.querySelectorAll('#ppTabs .pp-tab')].find((x) => x.textContent.trim() === 'join').click();
      const ref = m.layers().find((L) => L.name === 'deposit.csv');
      const rs = [...document.querySelectorAll('#propPanel .pp-row')].find((r) => /^\s*right/.test(r.textContent)).querySelector('select');
      rs.value = String(ref.id); rs.dispatchEvent(new Event('change'));
      return J.id;
    }, v2);
    await h.p.waitForTimeout(500);
    return { wait: 2500, after: async () => {
      await h.ev(() => { const pp = document.querySelector('#propPanel'); if (pp && pp.classList.contains('show')) { const x = pp.querySelector('.pp-close, .x, [data-close]'); if (x) x.click(); else pp.classList.remove('show'); } });
      await removeLayers(h, [rid, v2]);
      await h.ev((vv) => { for (const [id, on] of vv) { const L = window._micro.layers().find((q) => q.id === id); if (L) L.visible = on; } window._micro.applyTreeVisibility(); window._micro.renderLayers(); }, vis);
    } };
  },
  'structure-window': async (h) => {
    const st = await structureSetup(h);
    await structCam(h);
    await place(h, '^structure ·', 800, 110, 620, 470);
    await h.p.mouse.move(700, 870);
    return { wait: 2500, after: () => structureUndo(h, st) };
  },
  'structure-stereonet': async (h) => {
    const st = await structureSetup(h);
    await structCam(h);
    await h.ev(() => {
      const w = [...document.querySelectorAll('.fwin')].find((e) => /^structure ·/.test(e.querySelector('.t').textContent));
      const b = [...w.querySelectorAll('button')].find((x) => /stop/.test(x.textContent)); if (b) b.click();   // the wand off: the lasso is on the net
      [...w.querySelectorAll('button')].find((x) => /stereonet/.test(x.textContent)).click();
    });
    await h.p.waitForTimeout(400);
    await place(h, '^stereonet ·', 360, 100, 380, 470);
    await h.p.waitForTimeout(400);
    // a lasso round the three J1 poles, dragged on the net
    const pts = await h.ev((lid) => {
      const m = window._micro, L = m.layers().find((q) => q.id === lid), hd = L._structView, sn = hd.stereo.sn;
      const el = sn.element(), r = el.getBoundingClientRect(), NETW = +el.getAttribute('width') || r.width;
      const k = r.width / (el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.width || NETW);
      return hd.planes.filter((p) => p.set === 'J1').map((p) => { const v = p.nz > 0 ? [-p.nx, -p.ny, -p.nz] : [p.nx, p.ny, p.nz]; const q = sn.project(v); return [r.left + q.x * k, r.top + q.y * k]; });
    }, st.lid);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs) - 14, x1 = Math.max(...xs) + 14, y0 = Math.min(...ys) - 14, y1 = Math.max(...ys) + 14;
    await h.p.mouse.move(x0, y0); await h.p.mouse.down();
    for (const [x, y] of [[x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]]) await h.p.mouse.move(x, y, { steps: 6 });
    await h.p.mouse.up();
    await h.p.mouse.move(1300, 870);
    return { el: h.win('^stereonet ·'), wait: 1200, after: () => structureUndo(h, st) };
  },
  'figures-panel': async (h) => {
    const prev = await decoOn(h, 'Demo deposit — FE', '#ffffff');
    await h.ev(() => {
      const m = window._micro, s = m.cam.state;
      m.toggleLayersPanel(false);
      s.phi = 1.1; s.theta = -Math.PI / 2 - 0.6; m.cam.update(); m.requestRender();
      m.openDecoPanel();
    });
    await h.p.waitForTimeout(400);
    await place(h, '^decorations', 24, 110, 330, 435);
    await h.p.mouse.move(700, 880);
    return { wait: 2500, after: async () => { await closeAll(h); await decoOff(h, prev); await h.ev(() => window._micro.toggleLayersPanel(true)); } };
  },

  'figures-export': async (h) => {
    const prev = await decoOn(h, 'Demo deposit — FE, E–W section', '#ffffff');
    await h.ev(() => {
      const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
      m.setDeco('north', false);   // a vertical section looking north has no north arrow to draw (and micro's overlay arrow mis-points there — reported)
      m.setRampCfg(L, { preset: 'viridis', classed: true, breaks: [30, 40, 50, 55, 60], colors: null, hide: null });
      window.micro.setColorRange(L.id, { min: 20, max: 65 });
    });
    await h.p.mouse.move(900, 500); await h.p.keyboard.press('l');
    await h.ev(() => { const m = window._micro; m.cam.setOrtho(true); m.cam.dolly(0.5); m.requestRender(); });
    await h.p.waitForTimeout(1500);
    // the figure Export figure (PNG) writes at 2× — the very bytes, shown in the page for the capture
    const info = await h.ev(async () => {
      const b = await window.micro.snapshot({ scale: 2 });
      const head = [...new Uint8Array(await b.slice(0, 8).arrayBuffer())].join(',');
      if (!b.size || !head.startsWith('137,80')) return { err: `size ${b.size}, head ${head}` };
      // the PNG is large (2× the device-pixel canvas): decode it scaled to the page, then show that
      const full = await createImageBitmap(b);
      const W = innerWidth - 40, H = innerHeight - 40, k = Math.min(W / full.width, H / full.height);
      const c = document.createElement('canvas'); c.id = 'manual-figure';
      c.width = Math.round(full.width * k * devicePixelRatio); c.height = Math.round(full.height * k * devicePixelRatio);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(full, 0, 0, c.width, c.height);
      c.style.cssText = `position:fixed;z-index:999999;left:20px;top:20px;width:${c.width / devicePixelRatio}px;height:${c.height / devicePixelRatio}px;box-shadow:0 0 0 1px #888`;
      document.body.append(c);
      const img = { naturalWidth: full.width, naturalHeight: full.height };
      return { w: img.naturalWidth, h: img.naturalHeight, bytes: b.size };
    });
    if (info.err) throw new Error(info.err);
    console.log('  figures-export: the PNG is', info.w, '×', info.h, '·', info.bytes, 'bytes');
    return { el: '#manual-figure', wait: 600, after: async () => {
      await h.ev(() => { const i = document.querySelector('#manual-figure'); if (i) i.remove(); });
      await h.ev(() => {
        const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv');
        m.setRampCfg(L, { classed: false, breaks: [], colors: null, hide: null });
        window.micro.setColorRange(L.id, null); m.cam.setOrtho(false);
      });
      await decoOff(h, prev);
    } };
  },
  'compo-window': async (h) => {
    const st = await compoStart(h, 'demo plan');
    const ids = await compoPlanFigure(h, '**Figure {fig}.** Demo deposit — FE in plan, {section}.');
    await h.ev((id) => { const ed = window._micro.composerEditor(); ed.select([id]); ed.render(); }, ids.vf);
    await h.p.waitForTimeout(800);
    return { el: '.composer-win', blankOk: true, wait: 1500, after: () => compoEnd(h, st) };
  },
  'compo-fields': async (h) => {
    // one bench: a plan slab, so the caption counts that bench's blocks (captions count in the section)
    const st = await compoStart(h, 'demo fields', { section: { axis: 'z', position: 640, thickness: 10, clip: 'slab' } });
    await h.ev(async () => { document.querySelector('#filter').value = 'FE > 55'; await window._micro.applyBlockFilter('FE > 55'); });
    await h.p.waitForTimeout(800);
    const ids = await compoPlanFigure(h, '**Figure {fig}.** Bench {section}: {count:deposit.csv:,} blocks above 55 % Fe, mean {mean:FE:.1f} % Fe.');
    // right-click the view → Refresh fields (statistics)
    await h.ev(async (id) => {
      const m = window._micro, ed = m.composerEditor(), f = ed.getDoc().frames.find((x) => x.id === id);
      await m.composerFrameMenu(f, ed).find((x) => /^Refresh fields/.test(x.label)).run();
    }, ids.vf);
    await h.p.waitForTimeout(600);
    await h.ev(() => { const ed = window._micro.composerEditor(), t = ed.getDoc().frames.find((x) => x.kind === 'text'); ed.select([t.id]); ed.render(); });
    await h.p.waitForTimeout(800);
    return { el: '.composer-win', blankOk: true, wait: 1200, after: () => compoEnd(h, st) };
  },
  'compo-vector': async (h) => {
    // the demo's own E–W section (h.reset leaves it: E–W, behind, through the lens); the drillholes
    // follow it — the fans cross that northing, so their intervals print as lines
    const st = await compoStart(h, 'demo vector', { hide: ['topography'], section: null, view: null });
    await h.ev(() => { const m = window._micro, dh = m.layers().find((L) => L.dh && L.docs && L.docs.dhDoc); m.renderer.setLayerSectioned(dh.id, true); window.micro.setPalette(dh.id, 'magma'); m.closeAllWindows(); });   // the holes on another palette, so their intervals read against the blocks
    await h.p.mouse.move(900, 500); await h.p.keyboard.press('l');   // face the section, as the tryit says
    await h.ev(() => {
      const m = window._micro, s2 = m.cam.state;
      m.cam.setOrtho(true); s2.target = [s2.target[0], s2.target[1], s2.target[2] - 55]; m.cam.update(); m.requestRender();   // down onto the lens: the shell's top and bottom in the frame
      m.openComposer('demo vector'); const w = document.querySelector('.composer-win'); w.style.left = '6px'; w.style.top = '8px'; w.style.width = '1428px'; w.style.height = '884px';
    });
    await h.p.waitForTimeout(800);
    const vid = await h.ev(async () => {
      const m = window._micro, ed = m.composerEditor();
      const vf = m.addViewFrame(ed, { box: [12, 14, 184, 104] });
      await m.composerFrameMenu(ed.getDoc().frames.find((x) => x.id === vf.id), ed).find((x) => /^Vector section/.test(x.label)).run();
      ed.select([vf.id]); ed.render();
      return vf.id;
    });
    console.log('  compo-vector:', await h.ev(() => document.querySelector('#meta').textContent));
    await h.p.waitForTimeout(500);
    await h.ev(() => {
      const side = document.querySelector('.composer-win .compo-side');
      const row = [...side.querySelectorAll('.row')].find((r) => r.firstChild && r.firstChild.textContent === 'coords');
      const sel = row.querySelector('select'); sel.value = [...sel.options].find((o) => /tick/.test(o.value + o.textContent)).value; sel.dispatchEvent(new Event('change'));
    });
    await h.p.waitForTimeout(300);
    await h.ev(() => { const i = document.querySelector('.composer-win .cmp-scale'); i.value = '2000'; i.dispatchEvent(new Event('change')); });
    await h.p.waitForTimeout(2500);
    await compoZoom(h, '5.67');
    await h.p.waitForTimeout(800);
    const clip = await frameClip(h, vid, 30);
    return { clip, blankOk: true, wait: 800, after: async () => {
      await h.ev(() => { const m = window._micro, dh = m.layers().find((L) => L.dh && L.docs && L.docs.dhDoc); m.renderer.setLayerSectioned(dh.id, false); window.micro.setPalette(dh.id, 'viridis'); });
      await compoEnd(h, st);
    } };
  },
  'compo-keyplan': async (h) => {
    const st = await compoStart(h, 'demo key plan', { hide: ['topography'], section: { axis: 'y', position: 7765495, thickness: 10, clip: 'slab' }, view: { look: 0, elevation: 0, ortho: true } });
    await h.ev(async () => {
      const m = window._micro, ed = m.composerEditor();
      m.cam.dolly(0.6); m.requestRender(); await new Promise((q) => setTimeout(q, 500));
      const vf = m.addViewFrame(ed, { box: [12, 14, 273, 120] });
      ed.addFrame({ kind: 'text', box: [12, 136, 200, 7], content: { md: '**Figure {fig}.** {section}', size: 9 } });
      ed.select([vf.id]);
    });
    await tb(h, '+ key plan');
    await h.p.waitForTimeout(1200);
    const clip = await pageClip(h);
    return { clip, blankOk: true, wait: 1200, after: () => compoEnd(h, st) };
  },

  'compo-multiples': async (h) => {
    const st = await compoStart(h, 'demo multiples', { hide: ['topography'], section: { axis: 'z', position: 640, thickness: 10, clip: 'slab' }, view: { look: 0, elevation: 90, ortho: true } });
    await h.ev(async () => {
      const m = window._micro, ed = m.composerEditor();
      const vf = m.addViewFrame(ed, { box: [12, 14, 273, 180] });
      await m.smallMultiples(ed, ed.getDoc().frames.find((x) => x.id === vf.id), { vary: 'section', values: [560, 600, 640, 680], axis: 'z', thickness: 10, cols: 2 });
    });
    await h.p.waitForTimeout(1500);
    const clip = await pageClip(h);
    return { clip, blankOk: true, wait: 1200, after: () => compoEnd(h, st) };
  },

  'compo-titleblock': async (h) => {
    const st = await compoStart(h, 'Demo deposit — FE plan');
    await h.ev(() => {
      const m = window._micro, ed = m.composerEditor();
      m.setHouseProps({ company: 'Example Mining', project: 'Demo deposit', client: '—', prepared: 'AB', checked: 'CD' });
      m.currentFigure().doc.props = { drawing: 'DD-001', revision: 'A' };
      m.addViewFrame(ed, { box: [12, 14, 180, 120] });
    });
    await tb(h, '+ title block');
    await h.p.waitForTimeout(500);
    await compoZoom(h, '7.56');
    await h.p.waitForTimeout(800);
    const clip = await h.ev(() => {
      const ed = window._micro.composerEditor(), ids = ed.selected().map((f) => f.id);
      ed.select([]);
      const els = [...document.querySelectorAll('.composer-win .compo-fr')].filter((x) => ids.includes(x.dataset.id));
      els[0].scrollIntoView({ block: 'center', inline: 'center' });
      const rs = els.map((e) => e.getBoundingClientRect()), g = 18;
      const x = Math.min(...rs.map((r) => r.left)) - g, y = Math.min(...rs.map((r) => r.top)) - g;
      return { x, y, width: Math.max(...rs.map((r) => r.right)) + g - x, height: Math.max(...rs.map((r) => r.bottom)) + g - y };
    });
    return { clip, blankOk: true, wait: 1000, after: () => compoEnd(h, st) };
  },
  'compo-retarget': async (h) => {
    const st = await compoStart(h, 'deposit report');
    st.extra = [];
    await h.ev(async () => {
      const m = window._micro, ed = m.composerEditor();
      const vf = m.addViewFrame(ed, { box: [12, 14, 168, 118] });
      ed.addFrame({ kind: 'text', box: [12, 136, 168, 8], content: { md: '**Figure {fig}.** Mean {mean:FE:.1f} % Fe in the view.', size: 9 } });
      await m.addResourceFrame({ layer: 'deposit.csv', grade: 'FE', cutoffs: [0, 40, 55], density: { col: 'SG', unit: 't/m3' }, groupBy: ['LITO'], metalFactor: 1, scope: 'all' });
    });
    // the next estimate: the same model, its domain column called ZONE
    const nid = await h.ev(async () => {
      const m = window._micro, t = await m.makeDemoBlockCsv().text();
      const i = t.indexOf('\n');
      return m.openBlob(new File([t.slice(0, i).replace('LITO', 'ZONE') + t.slice(i)], 'deposit_2027.csv'), 'deposit_2027.csv', 'add');
    });
    await h.ev(() => {
      const m = window._micro, w = m.openRetargetDialog(m.currentFigure());
      const box = [...w.el.querySelectorAll('.cmp-rt-layer')].find((b) => b.querySelector('b').textContent === 'deposit.csv');
      const sel = box.querySelector('select'); sel.value = 'deposit_2027.csv'; sel.dispatchEvent(new Event('change'));
      const row = [...box.querySelectorAll('select')].slice(1); for (const s2 of row) if (!s2.value && [...s2.options].some((o) => o.value === 'ZONE')) { s2.value = 'ZONE'; s2.dispatchEvent(new Event('change')); }
      w.el.style.left = '420px'; w.el.style.top = '160px'; w.el.style.height = '470px';
    });
    await h.p.waitForTimeout(600);
    return { el: '.cmp-retarget', blankOk: true, after: async () => { await compoEnd(h, st); await removeLayers(h, [nid]); } };
  },
  'atlas-pages': async (h) => {
    // the tryit's figure: plan, orthographic, a plan slab; view + legend + scale; the caption
    const st = await compoStart(h, 'bench plan', { hide: ['topography'], section: { axis: 'z', position: 640, thickness: 24, clip: 'slab' }, view: { look: 0, elevation: 90, ortho: true } });
    await h.ev(() => { const m = window._micro, ed = m.composerEditor(); const vf = m.addViewFrame(ed); ed.select([vf.id]); });
    await tb(h, '+ legend'); await tb(h, '+ scale');
    await h.ev(() => {
      const ed = window._micro.composerEditor(), d = ed.getDoc(), vf = d.frames.find((f) => f.source && f.source.kind === 'view');
      const legs = d.frames.filter((f) => f.kind === 'legend'), keep = legs.find((f) => f.source.layer === 'deposit.csv');
      ed.select(legs.filter((f) => f !== keep).map((f) => f.id));
      [...document.querySelectorAll('.composer-win button')].find((b) => /delete the selected frames/.test(b.title)).click();
      ed.addFrame({ kind: 'text', box: [vf.box[0], vf.box[1] + vf.box[3] + 11, vf.box[2], 8], content: { md: '**Figure {fig}.** Bench ${level} m RL — {count:deposit.csv:,} blocks. Page {page} of {pages}.', size: 9 } });
    });
    await h.p.waitForTimeout(600);
    // the atlas routine's compo step, page by page — compoPage per level, the pages into one PDF,
    // as the routine's book (atlas/bench_plan.pdf) collects them
    const out = await h.ev(async () => {
      const m = window._micro, C = await import('/ext/compo/index.js');
      const r = await m.makeAtlasRoutine(m.currentFigure(), { save: false });
      const step = r.params.steps[0], levels = step.each.level, w = step.steps[0].with;
      const pages = [];
      for (const lv of levels) pages.push(await m.compoPage({ figure: w.figure, view: { section: { ...w.view.section, position: lv } }, vars: { level: lv }, dpi: w.dpi }));
      const bytes = await C.exportPDF(pages, { env: m.composerEnv(), title: pages[0].title, creator: 'micro', dpi: w.dpi });
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { b64: btoa(bin), levels, thickness: w.view.section.thickness, book: w.book };
    });
    console.log(`  atlas-pages: levels ${out.levels.join(', ')} · thickness ${out.thickness} · ${out.book} · ${Math.round(out.b64.length * 0.75 / 1024)} KB`);
    // rasterise pages 1, 3, 6 with the vendored PDF.js, in a page of its own (micro's CSP forbids it)
    const origin = new URL(h.p.url()).origin;
    const q = await h.p.context().newPage();
    await q.setViewportSize({ width: 1440, height: 900 });
    await q.route(origin + '/__manual_blank', (rt) => rt.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0;background:#8a8f96"><div id="row" style="display:inline-flex;gap:18px;padding:18px"></div></body></html>' }));
    await q.goto(origin + '/__manual_blank');
    await q.addScriptTag({ url: origin + '/ext/pdfjs/vendor/pdf.min.js' });
    await q.evaluate(async ([b64, wurl]) => {
      const lib = window['pdfjs-dist/build/pdf']; lib.GlobalWorkerOptions.workerSrc = wurl;
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const pdf = await lib.getDocument({ data: u }).promise;
      for (const n of [1, 3, 6]) {
        const pg = await pdf.getPage(n), vp = pg.getViewport({ scale: 1.6 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        c.style.cssText = `width:${vp.width / 2}px;height:${vp.height / 2}px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)`;
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        document.querySelector('#row').append(c);
      }
    }, [out.b64, origin + '/ext/pdfjs/vendor/pdf.worker.min.js']);
    const file = (await import('path')).join((await import('url')).fileURLToPath(new URL('..', import.meta.url)), 'figures', 'shots', 'atlas-pages.png');
    await q.locator('#row').screenshot({ path: file });
    await q.close();
    // the harness captures after this; put the same file back once it has (the micro page isn't the picture)
    const png = await (await import('fs/promises')).readFile(file);
    return { blankOk: true, wait: 200, after: async () => { await (await import('fs/promises')).writeFile(file, png); await compoEnd(h, st); } };
  },
};
