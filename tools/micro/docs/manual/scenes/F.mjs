// scenes for figures/wanted/F.txt (Part VI Automation, Part VII Projects & trust) — see ../scenes.mjs
//
// Most of these share "the month-end project": the demo saved to an OPFS folder, with a grade-tonnage
// recipe and the month-end routine of ch. 28 + the checks of ch. 29. monthEnd(h) builds it once and
// every later call reuses it (it rebuilds only when the project isn't the one it made).

const PROJ = 'manual-monthend';

// a floating window by its title, moved and sized so the picture reads
const place = (h, re, x, y, w, ht) => h.ev(([src, x2, y2, w2, h2]) => {
  const el = [...document.querySelectorAll('.fwin')].reverse().find((e) => new RegExp(src, 'i').test(e.querySelector('.t').textContent));
  if (!el) return false;
  el.style.left = x2 + 'px'; el.style.top = y2 + 'px'; if (w2) el.style.width = w2 + 'px'; if (h2) el.style.height = h2 + 'px';
  if (el._onResized) el._onResized();
  return true;
}, [re, x, y, w, ht]);
const closeAll = (h) => h.ev(() => window._micro.closeAllWindows());
const waitMeta = (h, re, timeout = 120000) => h.p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#meta').textContent), re, { timeout });

// the recipes, as plain objects (written to recipes/*.yaml in block style, strings double-quoted)
const GT_RECIPE = { name: 'deposit grade-tonnage', tool: 'gt', params: { layer: 'deposit.csv', series: [{ layer: 'deposit.csv', col: 'FE', unit: 'pct', weight: 'SG' }], gradeUnit: 'pct', cutoffs: [30, 40, 50, 55, 60, 65] } };
const MONTH_END = { name: 'month-end', tool: 'routine', params: { steps: [
  { tool: 'modelqa', with: { layer: 'deposit.csv' }, as: 'mq' },
  { tool: 'dhqa', with: { layer: 'demo_assay.csv' }, as: 'dq' },
  { recipe: 'deposit grade-tonnage', with: { cutoffs: [30, 40, 50, 55, 60, 65] }, as: 'gt' },
  { tool: 'validation', with: { model: 'deposit.csv', samples: 'demo_assay.csv', modelGrade: 'FE', sampleGrade: 'FE', axis: 'Y', bandW: 50 }, as: 'val' },
  { each: [{ lito: 'HEMATITE' }, { lito: 'ITABIRITE' }, { lito: 'CANGA' }], steps: [
    { tool: 'stats', with: { layer: 'deposit.csv', cols: ['FE', 'SG'], filter: 'LITO = "$lito"' }, as: 'stats' },
  ] },
  { tool: 'export', with: { layer: 'deposit.csv', format: 'parquet', filter: 'FE >= 55', out: 'ore.parquet' }, as: 'ore' },
  { check: 'mq.errors = 0', say: 'the model has no QA errors' },
  { check: 'abs(val.bias_pct) < 5', say: 'model mean within 5% of the declustered samples', level: 'warn' },
  { compare: 'gt', tolerance: 0.1, level: 'warn' },
] } };

// write recipe objects into the open project's recipes/ and re-read the folder (so the YAML is checked
// by micro's own reader); returns the recipe names micro now lists
const writeRecipes = (h, list) => h.ev(async (rs) => {
  const m = window._micro, dir = m.project().dir;
  const sc = (v) => typeof v === 'number' || typeof v === 'boolean' ? String(v) : (String(v).includes('"') && !String(v).includes("'") ? `'${v}'` : JSON.stringify(String(v)));
  const emit = (v, ind) => {
    const pad = ' '.repeat(ind), out = [];
    if (Array.isArray(v)) {
      for (const x of v) {
        if (x && typeof x === 'object' && !Array.isArray(x)) { const sub = emit(x, ind + 2); sub[0] = pad + '- ' + sub[0].slice(ind + 2); out.push(...sub); }
        else out.push(pad + '- ' + sc(x));
      }
    } else {
      for (const [k, x] of Object.entries(v)) {
        if (x == null) continue;
        if (typeof x === 'object') { out.push(`${pad}${k}:`); out.push(...emit(x, ind + 2)); }
        else out.push(`${pad}${k}: ${sc(x)}`);
      }
    }
    return out;
  };
  const rd = await dir.getDirectoryHandle('recipes', { create: true });
  for (const r of rs) {
    const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const w = await (await rd.getFileHandle(slug + '.yaml', { create: true })).createWritable();
    await w.write(emit(r, 0).join('\n') + '\n'); await w.close();
  }
  await m.loadRecipes(dir);
  return m._recipesList().map((x) => x.name);
}, list);
const removeRecipes = (h, names) => h.ev(async (ns) => {
  const m = window._micro, P = m.project(); if (!P || !P.dir) return;
  const list = m._recipesList();
  for (const n of ns) {
    const r = list.find((x) => x.name === n); if (!r) continue;
    try { const rd = await P.dir.getDirectoryHandle('recipes'); await rd.removeEntry(r.file.split('/').pop()); } catch { /* not on disk */ }
    list.splice(list.indexOf(r), 1);
  }
}, names);

// reopen the demo project from scratch, in memory (no folder)
async function freshDemo(h) {
  await h.ev(async () => { try { await window._micro.closeProject(); } catch { } await window._micro.openDemoProject(); });
  await h.p.waitForFunction(() => window._micro.layers().length >= 6 && window._micro.layers().some((L) => L.dh && L.docs && L.docs.dhDoc), null, { timeout: 120000 });
  await h.p.waitForTimeout(800);
}

// the month-end project: the demo saved to OPFS/<PROJ>, its two recipes. Built once, reused.
async function monthEnd(h) {
  const ready = await h.ev((pn) => { const m = window._micro, P = m.project(); return !!(P && P.dir && P.dir.name === pn && m._recipesList().some((r) => r.name === 'month-end')); }, PROJ);
  if (ready) return;
  await freshDemo(h);
  await h.ev(async (pn) => {
    const m = window._micro;
    m.setAutoPack('off');
    m.setAutoOptimize('off');
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(pn, { recursive: true }); } catch { }
    window.showDirectoryPicker = async () => root.getDirectoryHandle(pn, { create: true });
    document.querySelector('#meta').textContent = '';
    m.saveProjectAs();
  }, PROJ);
  await h.p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await h.ev(() => { const d = document.querySelector('#svDlg'); if (d.classList.contains('show')) document.querySelector('#svCopy').click(); });
  await waitMeta(h, 'project saved', 180000);
  await writeRecipes(h, [GT_RECIPE, MONTH_END]);
  await h.p.waitForTimeout(500);
}

// open a Tools → Recipes submenu path the way a user does (the menubar), leaving the last menu open
async function recipesMenu(h, ...path) {
  await h.ev(() => document.querySelectorAll('.menu').forEach((x) => x.remove()));
  await h.p.locator('#mTools').click();
  await h.p.waitForTimeout(250);
  await h.p.locator('.menu .item:has-text("Recipes")').last().hover();
  for (const label of path) { await h.p.waitForTimeout(250); await h.p.locator(`.menu .item:has-text("${label}")`).last().hover(); }
  await h.p.waitForTimeout(250);
}
const clickMenu = (h, label) => h.p.locator(`.menu .item:has-text("${label}")`).last().click();

const fwin = (h, attr) => `.fwin[data-${attr}]`;

export const SCENES = {
  'recipes-form': async (h) => {
    await monthEnd(h);
    await h.ev(() => {
      const m = window._micro, win = m.openRecipeForm('gt');
      const rows = [...win.el.querySelectorAll('.rf-row')];
      const byKey = (k) => rows.find((r) => r.firstChild && r.firstChild.textContent.replace(' *', '') === k);
      win.el.querySelector('.rf-top input').value = 'deposit grade-tonnage';
      const ls = byKey('layer').querySelector('select'); ls.value = 'deposit.csv'; ls.dispatchEvent(new Event('change'));
      const item = byKey('series').querySelector('.rf-item');
      const sub = (k) => [...item.querySelectorAll('.rf-row')].find((r) => r.firstChild.textContent.replace(' *', '') === k);
      const set = (k, v) => { const r = sub(k); if (!r) return; const i = r.querySelector('input, select'); i.value = v; i.dispatchEvent(new Event('change')); };
      set('layer', 'deposit.csv'); set('col', 'FE'); set('unit', 'pct'); set('weight', 'SG');
      byKey('cutoffs').querySelector('input').value = '30, 40, 50, 55, 60, 65';
      const gu = byKey('gradeUnit'); if (gu) { const s = gu.querySelector('select, input'); s.value = 'pct'; s.dispatchEvent(new Event('change')); }
    });
    await place(h, 'new recipe', 460, 120, 520, 432);
    return { el: fwin(h, 'recipe-form'), blankOk: true, after: () => closeAll(h) };
  },

  'recipes-inputs': async (h) => {
    await monthEnd(h);
    await writeRecipes(h, [{ name: 'GT — any model', tool: 'gt',
      inputs: [{ name: 'model', label: 'Block model', type: 'layer' }, { name: 'grade', label: 'Grade column', type: 'column', of: 'model' }, { name: 'density', label: 'Density column', type: 'column', of: 'model' }],
      params: { layer: '$model', gradeUnit: 'pct', cutoffs: [30, 40, 50, 60], series: [{ layer: '$model', col: '$grade', unit: 'pct', weight: '$density' }] } }]);
    await recipesMenu(h, 'GT — any model');
    await clickMenu(h, 'Run…');
    await h.p.waitForTimeout(600);
    await h.ev(() => {
      const w = [...document.querySelectorAll('.fwin')].reverse().find((e) => /GT — any model/.test(e.querySelector('.t').textContent));
      const sels = [...w.querySelectorAll('select')];
      const pick = (s, v) => { const o = [...s.options].find((q) => q.value === v || q.textContent === v); if (o) { s.value = o.value; s.dispatchEvent(new Event('change')); } };
      pick(sels[0], 'deposit.csv');
      const s2 = [...w.querySelectorAll('select')]; pick(s2[1], 'FE'); pick(s2[2], 'SG');
    });
    await h.p.waitForTimeout(300);
    await place(h, 'GT — any model', 530, 300, 380, 170);
    return { el: h.win('GT — any model'), blankOk: true, after: async () => { await closeAll(h); await removeRecipes(h, ['GT — any model']); } };
  },

  'recipes-checkall': async (h) => {
    await monthEnd(h);
    await writeRecipes(h, [{ name: 'typo gt', tool: 'gt', params: { layer: 'deposit.csv', series: [{ col: 'FE' }], cutofs: [50] } }]);
    await recipesMenu(h);
    await clickMenu(h, 'Check all recipes…');
    await h.p.waitForFunction(() => { const w = document.querySelector('.fwin[data-check-recipes]'); return w && !/checking/.test(w.querySelector('.sub').textContent); }, null, { timeout: 60000 });
    await place(h, 'check all recipes', 360, 140, 720, 150);
    return { el: fwin(h, 'check-recipes'), blankOk: true, after: async () => { await closeAll(h); await removeRecipes(h, ['typo gt']); } };
  },

  'routines-editor': async (h) => {
    await monthEnd(h);
    // the variant: one input (model, a layer), the guard, the model named through $model
    await h.ev(() => {
      const m = window._micro, base = m._recipesList().find((r) => r.name === 'month-end');
      const v = JSON.parse(JSON.stringify(base));
      v.inputs = [{ name: 'model', type: 'layer', label: 'Block model', default: 'deposit.csv' }];
      const sub = (o) => { for (const k of Object.keys(o)) { if (o[k] === 'deposit.csv') o[k] = '$model'; else if (o[k] && typeof o[k] === 'object') sub(o[k]); } };
      sub(v.params.steps);
      // the check / compare steps have no row of their own in the editor (they show as empty "run" rows
      // with their YAML) — they're written in the file (ch. 28's note), so the variant leaves them out
      v.params.steps = v.params.steps.filter((st) => !st.check && !st.compare);
      v.params.steps.unshift({ guard: 'no-overwrites' });
      m.openRoutineWindow(v);
    });
    await h.p.waitForTimeout(500);
    await place(h, 'routine · month-end', 380, 14, 680, 872);
    await h.ev(() => {
      const w = document.querySelector('.fwin[data-routine]');
      [...w.querySelectorAll('button')].find((b) => b.textContent === 'Preview').click();
      // fold each step's YAML box (the ⋯ toggle), so the outline of the routine reads in one window
      for (const b of [...w.querySelectorAll('button.rw-x')].filter((x) => x.textContent === '⋯')) { const ta = b.parentElement.nextElementSibling; if (ta && ta.tagName === 'TEXTAREA' && ta.style.display !== 'none') b.click(); }
    });
    await h.p.waitForTimeout(1200);
    await h.ev(() => { const s = document.querySelector('.fwin[data-routine] .rw-scroll'); if (s) s.scrollTop = 0; });
    await h.p.waitForTimeout(300);
    return { el: fwin(h, 'routine'), blankOk: true, after: () => closeAll(h) };
  },

  'routines-tracker': async (h) => {
    await monthEnd(h);
    // Run fresh, from the menu, and capture the tracker mid-run (≥ 5 steps ticked, one ▶). The export's
    // file write is held a few seconds (a slow disk) so the capture can't miss the window.
    await h.ev(() => {
      const proto = FileSystemFileHandle.prototype;
      if (!proto._manualCW) proto._manualCW = proto.createWritable;
      proto.createWritable = async function (...a) { if (/^ore/.test(this.name)) await new Promise((r) => setTimeout(r, 15000)); return proto._manualCW.apply(this, a); };
    });
    await recipesMenu(h, 'month-end');
    await clickMenu(h, 'Run fresh');
    await h.p.waitForFunction(() => { const w = document.querySelector('.fwin[data-routine-run]'); return w && /▶/.test(w.textContent) && (w.textContent.match(/✓/g) || []).length >= 5; }, null, { timeout: 120000 });
    await place(h, 'month-end', 290, 200, 860, 260);
    return { el: '.fwin[data-routine-run]', blankOk: true, wait: 400, after: async () => {
      await h.ev(() => { const proto = FileSystemFileHandle.prototype; if (proto._manualCW) { proto.createWritable = proto._manualCW; delete proto._manualCW; } });
      await waitMeta(h, 'routine “month-end” (— \\d+ steps? run|STOPPED)', 120000);
      await closeAll(h);
    } };
  },

  'runs-window': async (h) => {
    await monthEnd(h);
    await h.ev(async () => {
      const m = window._micro, dir = m.project().dir;
      try { await dir.removeEntry('runs', { recursive: true }); } catch { }
      const r1 = await window.micro.runRoutine('month-end');
      await m.acceptRun(r1.record ? r1.record.dir : (await m.listRuns())[0].dir, 'A. Geologist');
      await window.micro.runRoutine('month-end');
      await window.micro.runRoutine('month-end');
      m.closeAllWindows();
      await m.openRunsWindow();
    });
    await h.p.waitForTimeout(500);
    await place(h, '^runs$', 300, 160, 880, 150);
    return { el: fwin(h, 'runs'), blankOk: true, after: () => closeAll(h) };
  },

  'library-window': async (h) => {
    await monthEnd(h);
    await h.ev(async () => {
      const m = window._micro;
      for (const p of await m.libraryList()) await m.libraryDelete(p.main.name);
      const r = m._recipesList().find((x) => x.name === 'month-end');
      await m.libraryPut(await m.packFromProject(r));
      await m.openLibraryWindow();
    });
    await h.p.waitForTimeout(500);
    await place(h, 'recipe library', 260, 160, 920, 170);
    return { el: fwin(h, 'library'), blankOk: true, after: () => closeAll(h) };
  },

  'library-outputs': async (h) => {
    await monthEnd(h);
    await h.ev(async () => {
      const m = window._micro;
      for (const p of await m.libraryList()) await m.libraryDelete(p.main.name);
      const r = m._recipesList().find((x) => x.name === 'month-end');
      await m.libraryPut(await m.packFromProject(r));
      await m.closeProject();
      await m.openLibraryWindow();
    });
    await h.p.waitForTimeout(400);
    await h.ev(() => { const w = document.querySelector('.fwin[data-library]'); const row = w.querySelector('[data-pack="month-end"]'); [...row.querySelectorAll('button')].find((b) => b.textContent === 'Run → zip').click(); });
    await h.p.waitForFunction(() => document.querySelector('.fwin[data-run-outputs]'), null, { timeout: 180000 });
    await h.ev(() => { document.querySelectorAll('.fwin:not([data-run-outputs])').forEach((w) => { const x = w.querySelector('.x, .close, button[title="close"]'); if (x) x.click(); }); });
    await h.p.waitForTimeout(300);
    await place(h, '^outputs', 470, 140, 500, 270);
    return { el: '.fwin[data-run-outputs]', blankOk: true, after: () => closeAll(h) };
  },

  'projects-save-dialog': async (h) => {
    await freshDemo(h);
    await h.ev(async () => {
      const m = window._micro;
      m.setAutoPack('off');
      m.setAutoOptimize('off');
      const root = await navigator.storage.getDirectory();
      try { await root.removeEntry('manual-save', { recursive: true }); } catch { }
      window.showDirectoryPicker = async () => root.getDirectoryHandle('manual-save', { create: true });
      m.saveProjectAs();
    });
    await h.p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show'), null, { timeout: 60000 });
    await h.p.waitForTimeout(300);
    return { el: '#svDlg .box', after: () => h.ev(() => document.querySelector('#svCancel').click()) };
  },

  'sealed-badge': async (h) => {
    await h.p.locator('#sealBadge').first().click();
    await h.p.waitForTimeout(500);
    const clip = await h.ev(() => {
      const b = document.querySelector('#sealBadge').getBoundingClientRect();
      const p = document.querySelector('#sealPop').getBoundingClientRect();
      const right = Math.max(b.right, p.right) + 24, bottom = Math.max(b.bottom, p.bottom) + 24;
      return { x: 0, y: 0, width: Math.min(1440, right), height: Math.min(900, bottom) };
    });
    return { clip, after: () => h.ev(() => { const x = document.querySelector('#sealPop'); if (x) x.remove(); }) };
  },

  'mobile-review': async (h) => {
    await h.p.setViewportSize({ width: 412, height: 915 });
    await h.p.waitForFunction(() => document.body.classList.contains('mobile'), null, { timeout: 10000 });
    await h.p.waitForTimeout(800);
    await h.ev(() => { const m = window._micro, L = m.layers().find((x) => x.name === 'deposit.csv'); m.openGradeTonnage(L, { cfg: { series: [{ layer: 'deposit.csv', col: 'FE', unit: 'pct', weight: 'SG', filter: '' }], nCut: 40, scope: 'all', gradeUnit: 'pct', densUnit: 't/m3' }, run: true }); });
    await h.p.waitForFunction(() => { const w = document.querySelector('.fwin.sheet'); return w && w._gtSpec; }, null, { timeout: 60000 });
    await h.p.waitForTimeout(800);
    await h.fit();
    await h.p.waitForTimeout(600);
    await h.ev(() => { const m = window._micro; m.cam.dolly(0.62); m.requestRender(); });   // the model fills the view above the sheet
    return { wait: 2000, after: async () => {
      await closeAll(h);
      await h.p.setViewportSize({ width: 1440, height: 900 });
      await h.p.waitForFunction(() => !document.body.classList.contains('mobile'), null, { timeout: 10000 });
      await h.p.waitForTimeout(500);
    } };
  },
};
