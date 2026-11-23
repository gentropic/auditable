// Builds the micro manual: figures from a live micro, then the book.
//
//   node tools/micro/docs/manual/build.mjs            everything (data · tools · shots · pdf)
//   node tools/micro/docs/manual/build.mjs data tools  only those phases
//   node tools/micro/docs/manual/build.mjs shots --only gt-window,demo-scene
//
// data  — every `data <name> | {"tool":…,"params":…}` line in figures/wanted/*.txt is run with
//         window.micro.runTool on the demo project → figures/data/<name>.tsv (the tool's machine
//         table, so a chart in the book is micro's own numbers, never retyped)
// tools — chapters/C-tools.tex, the tool reference, from window.micro.tools()
// shots — every screenshot named in figures/wanted/*.txt that scenes.mjs knows how to stage →
//         figures/shots/<name>.png; a name with no scene is listed, and the book shows a placeholder
// pdf   — latexmk (LuaLaTeX, biber for references.bib) → build/micro-manual.pdf
import { chromium } from 'playwright';
import http from 'http';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { extname, join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { SCENES } from './scenes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const argv = process.argv.slice(2);
const onlyArg = argv.find((a) => a.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : argv[argv.indexOf(onlyArg) + 1]).split(',') : null;
const FAST = argv.includes('--fast');                    // shots: one shared page (quick) instead of a fresh micro per scene
const PHASES = argv.filter((a) => !a.startsWith('--') && !(onlyArg && a === argv[argv.indexOf(onlyArg) + 1]));
const want = (ph) => !PHASES.length || PHASES.includes(ph);

// ── the wanted lists ──
async function readWanted() {
  const dir = join(HERE, 'figures', 'wanted');
  const shots = new Map(), data = new Map();
  if (!existsSync(dir)) return { shots, data };
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.txt')).sort()) {
    for (const raw of (await readFile(join(dir, f), 'utf8')).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = /^data\s+([\w-]+)\s*\|\s*(\{.*\})\s*$/.exec(line);
      if (m) { try { data.set(m[1], { ...JSON.parse(m[2]), from: f }); } catch (e) { console.log(`wanted: ${f}: bad JSON for ${m[1]} — ${e.message}`); } continue; }
      const [name, state = '', kind = 'full'] = line.split('|').map((s) => s.trim());
      if (/^[\w-]+$/.test(name)) shots.set(name, { state, kind, from: f });
    }
  }
  return { shots, data };
}

// ── a live micro (the dev tree, served from the repo root) ──
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm' };
async function startMicro() {
  const server = http.createServer(async (req, res) => {
    try { const path = decodeURIComponent(new URL(req.url, 'http://x').pathname); const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=angle'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('  page error:', e.message));
  p.setDefaultTimeout(60000);
  await p.goto(`http://127.0.0.1:${server.address().port}/tools/micro/index.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window.micro, null, { timeout: 30000 });
  return { p, close: async () => { await browser.close(); server.close(); } };
}

async function openDemo(p) {
  await p.evaluate(() => window._micro.openDemoProject());
  await p.waitForFunction(() => window._micro.layers().length >= 6 && window._micro.layers().some((L) => L.dh && L.docs && L.docs.dhDoc), null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  // what every scene's reset restores: each demo layer's visibility, opacity and colour-by as opened
  await p.evaluate(() => { window.__demoState = Object.fromEntries(window._micro.layers().map((L) => [L.name, { visible: L.visible !== false, opacity: L.opacity ?? 1, colorSel: L.colorSel ?? null }])); });
}

// ── data: micro's own numbers for the charts ──
async function phaseData(p, data) {
  const out = join(HERE, 'figures', 'data');
  await mkdir(out, { recursive: true });
  const layers = await p.evaluate(() => window._micro.layers().map((L) => L.name));
  for (const [name, spec] of data) {
    if (ONLY && !ONLY.includes(name)) continue;
    try {
      const res = await p.evaluate(([t, prm]) => window.micro.runTool(t, prm), [spec.tool, spec.params || {}]);
      const t = res.table;
      if (!t) throw new Error('the tool returned no table');
      const cell = (v) => (v == null || v === '' ? 'nan' : typeof v === 'number' ? String(v) : String(v).replace(/\s+/g, '_'));
      const tsv = [t.columns.map((c) => String(c).replace(/\s+/g, '_')).join('\t'), ...t.rows.map((r) => r.map(cell).join('\t'))].join('\n') + '\n';
      await writeFile(join(out, name + '.tsv'), tsv);
      console.log(`data: ${name} (${t.rows.length} rows: ${t.columns.join(', ')})`);
    } catch (e) {
      console.log(`data: ${name} FAILED — ${e.message.split('\n')[0]}  [layers: ${layers.join(' · ')}]`);
      process.exitCode = 1;
    }
  }
}

// ── tools: the generated tool reference (Appendix C) ──
const tex = (s) => String(s ?? '').replace(/\\/g, '\\textbackslash{}').replace(/([%&#_$])/g, '\\$1').replace(/([{}])/g, '\\$1').replace(/\^/g, '\\^{}').replace(/~/g, '\\~{}');
function typeOf(v) {
  if (v.values) return v.values.map((x) => `\\code{${tex(x)}}`).join(' · ');
  if (v.type === 'list' && v.item) return 'list of \\{' + Object.keys(v.item).map((k) => `\\code{${tex(k)}}`).join(', ') + '\\}';
  return tex(v.type || '');
}
function toolsTex(tools) {
  const L = [];
  L.push('% GENERATED by build.mjs from window.micro.tools() — do not edit by hand');
  L.push('\\chapter{Tool reference}\\label{app:tools}\\label{ch:tools}');
  L.push('\\begin{goals}\\textbf{This appendix} lists every analysis a routine step (or \\code{window.micro.runTool}) can run: its settings, their types and defaults, and the columns that key its machine table. It is generated from micro itself, so it is exact for this version.\\end{goals}');
  L.push('A routine step names a tool and puts its settings under \\code{with:} (\\cref{ch:routines}). A setting marked \\emph{routine} has a rule in a routine that a window doesn\'t have — most often that it must be stated, because an automatic value would move with the data.');
  for (const t of tools) {
    L.push(`\\section{${tex(t.label)} \\textmd{\\normalsize\\ttfamily\\color{muted}(${tex(t.name)})}}\\label{tool:${t.name}}`);
    L.push(`\\index{tool!${tex(t.name)}}\\code{tool: ${tex(t.name)}}${t.outputs.key.length ? ` — the machine table is keyed by ${t.outputs.key.map((k) => `\\col{${tex(k)}}`).join(', ')}.` : '.'}`);
    const rows = Object.entries(t.params);
    if (!rows.length) continue;
    L.push('\\begin{center}\\small\\begin{tabularx}{\\linewidth}{@{}>{\\ttfamily\\raggedright}p{0.2\\linewidth}>{\\raggedright}p{0.24\\linewidth}L@{}}\\toprule');
    L.push('\\normalfont\\sffamily\\bfseries setting & \\sffamily\\bfseries type & \\sffamily\\bfseries meaning \\\\\\midrule');
    for (const [k, v] of rows) {
      const bits = [];
      if (v.doc) bits.push(tex(v.doc));
      if (v.required) bits.push('\\textcolor{amber}{required}');
      if (v.default !== undefined) bits.push(`default \\code{${tex(JSON.stringify(v.default))}}`);
      if (v.routine) bits.push(`\\emph{routine:} ${tex([].concat(v.routine).join('; '))}`);
      if (v.item) bits.push('each item: ' + Object.entries(v.item).map(([ik, iv]) => `\\code{${tex(ik)}} (${tex(iv.type)}${iv.required ? ', required' : ''})`).join(', '));
      L.push(`${tex(k)} & ${typeOf(v)} & ${bits.join('. ') || '—'} \\\\`);
    }
    L.push('\\bottomrule\\end{tabularx}\\end{center}');
  }
  return L.join('\n') + '\n';
}
async function phaseTools(p) {
  const tools = await p.evaluate(() => window.micro.tools());
  await writeFile(join(HERE, 'chapters', 'C-tools.tex'), toolsTex(tools));
  console.log(`tools: ${tools.length} → chapters/C-tools.tex`);
}

// ── shots ──
// WebGL screenshots can race the swap (a capture between presents reads a cleared canvas), so a
// shot with 3D in it is checked for lit pixels in the FILE and retried (the docs/shots.mjs lesson).
async function litPixels(p, file) {
  const b64 = (await readFile(file)).toString('base64');
  return p.evaluate(async (data) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + data; });
    const c = document.createElement('canvas'); c.width = 200; c.height = 120;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 200, 120);
    const d = g.getImageData(0, 0, 200, 120).data;
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit;
  }, b64);
}
async function phaseShots(p, shots) {
  const out = join(HERE, 'figures', 'shots');
  await mkdir(out, { recursive: true });
  const missing = [];
  const h = makeHelpers(p);
  for (const [name, w] of shots) {
    if (ONLY && !ONLY.includes(name)) continue;
    const scene = SCENES[name];
    if (!scene) { missing.push(`${name}  (${w.from}: ${w.state})`); continue; }
    try {
      // each scene starts from a FRESH micro with the demo freshly opened: in one shared page a scene
      // that changed deeper state (a layer hidden, a colour, a render mode) blanked later shots —
      // whatever reset() didn't think to undo. --fast reuses the page (quick iteration on one scene).
      if (!FAST) {
        await p.reload({ waitUntil: 'load' });
        await p.waitForFunction(() => window._micro && window.micro, null, { timeout: 30000 });
        await openDemo(p);
      }
      await h.reset();
      const r = (await scene(h)) || {};
      await p.waitForTimeout(r.wait || 1200);
      const file = join(out, name + '.png');
      for (let attempt = 0; ; attempt++) {
        await p.evaluate(() => new Promise((res) => { window._micro.requestRender(); requestAnimationFrame(() => requestAnimationFrame(res)); }));
        const target = r.el ? p.locator(r.el).last() : p;
        await target.screenshot({ path: file, ...(r.clip ? { clip: r.clip } : {}) });
        if (r.blankOk || (await litPixels(p, file)) > 300 || attempt >= 3) break;
        await p.waitForTimeout(1500);
      }
      if (r.after) await r.after();   // a scene's undo of deeper state, after the capture
      console.log('shot:', name);
    } catch (e) { console.log(`shot: ${name} FAILED — ${e.message.split('\n')[0]}`); process.exitCode = 1; }
  }
  if (missing.length) console.log(`shots without a scene yet (${missing.length}):\n  ` + missing.join('\n  '));
}

// helpers a scene gets: the page, the demo's layers by name, window handling
function makeHelpers(p) {
  const h = {
    p,
    ev: (fn, arg) => p.evaluate(fn, arg),
    // back to the demo as it opens: windows closed, no filter, no selection, section as the demo sets it
    reset: async () => {
      // a scene that closed the project (the start screen) or lost a demo layer gets the demo back
      if (!(await p.evaluate(() => window._micro.layers().length >= 6 && window._micro.layers().some((L) => L.name === 'deposit.csv')))) {
        await p.evaluate(async () => { try { await window._micro.closeProject(); } catch {} });
        await openDemo(p);
      }
      await p.evaluate(async () => {
        const m = window._micro;
        m.closeAllWindows(); try { m.closePalette(); } catch {}
        // micro bug workaround: closing an analysis window saves its geometry AFTER el.remove(),
        // i.e. [0,0,0,0], so it would reopen 0×0 — forget remembered geometry between scenes
        for (const L of m.layers()) if (L.analysis && L.analysis.geo) L.analysis.geo = {};
        try { for (const k of Object.keys(localStorage)) if (k.startsWith('micro.winGeo.')) localStorage.removeItem(k); } catch {}
        for (const d of document.querySelectorAll('.dlg.open, .dlg[open]')) d.classList.remove('open');
        for (const d of document.querySelectorAll('[id$="Dlg"].show')) { const x = d.querySelector('.hd button'); if (x) x.click(); d.classList.remove('show'); }
        document.querySelectorAll('.menu').forEach((x) => x.remove());   // a context menu left open by a scene
        const hp = document.querySelector('#help'); if (hp) hp.classList.remove('show');   // the help / file-info overlay
        document.querySelector('#filter').value = ''; try { await m.applyBlockFilter(''); } catch {}
        try { m.clearSelection(); } catch {}
        // every demo layer back to how the demo opened it: a scene that hid the model (QA / structure
        // scenes set L.visible directly) used to leave later shots with no blocks
        const snap = window.__demoState || {};
        for (const L of m.layers()) {
          const s0 = snap[L.name]; if (!s0) continue;
          L.visible = s0.visible;
          if (L.opacity !== s0.opacity) { L.opacity = s0.opacity; try { m.renderer.setLayerOpacity(L.id, s0.opacity); } catch {} }
          if (s0.colorSel != null && L.colorSel !== s0.colorSel) { try { m.setLayerColorSel(L, s0.colorSel); } catch {} }
        }
        try { m.applyTreeVisibility(); } catch {}
        const bm = m.layers().find((L) => L.name === 'deposit.csv'); if (bm) m.setActiveLayer(bm.id);
        // no picked record; camera + section as the demo opens them (2D off, its bookmark, the
        // E–W half-space, holes uncut, then fit — openDemoProject's own order)
        const rp = document.querySelector('#recPanel'); if (rp && rp.classList.contains('show')) document.querySelector('#rpClose').click();
        const c2 = document.querySelector('#sec2D'); if (c2 && c2.checked) { c2.checked = false; c2.dispatchEvent(new Event('input')); }
        const v = m.views().find((x) => x.name === 'Ore lens — E–W section'); if (v) m.applyView(v);
        m.applySection({ mode: 'ew', clip: 'behind', pos: 0.45, half: 5 });
        const dh = m.layers().find((L) => L.dh && L.docs && L.docs.dhDoc); if (dh) m.renderer.setLayerSectioned(dh.id, false);
        document.querySelector('#btnFit').click();
        // the status line as the demo leaves it (applyView above wrote "bookmark …" there)
        document.querySelector('#meta').textContent = 'demo project — a deposit, drillholes, topography, mining phases and the ore shell, sectioned, with grade–tonnage. File → Save project as… writes it all to a folder.';
      });
    },
    layer: (name) => p.evaluate((n) => { const L = window._micro.layers().find((x) => x.name === n || x.label === n); return L ? L.id : null; }, name),
    win: (re) => `.fwin:has(.t:text-matches("${re}", "i"))`,
    lastWin: '.fwin >> nth=-1',
    fit: () => p.evaluate(() => { document.querySelector('#btnFit').click(); }),
  };
  return h;
}

// ── pdf ──
function phasePdf() {
  const r = spawnSync('latexmk', ['-lualatex', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-outdir=build', 'micro-manual.tex'], { cwd: HERE, stdio: 'inherit', shell: true, env: { ...process.env, TTFONTS: './fonts//;', OSFONTDIR: './fonts' } });   // the fallback symbol font ships in fonts/
  // latexmk exits non-zero on MiKTeX's "you have not checked for updates" nag alone — judge by the log
  let log = ''; try { log = readFileSync(join(HERE, 'build', 'micro-manual.log'), 'utf8'); } catch {}
  const errors = (log.match(/^\S+\.tex:\d+: .*$/gm) || []).length + (/Fatal error occurred/.test(log) ? 1 : 0);
  const overfull = (log.match(/^Overfull \\hbox/gm) || []).length, missing = (log.match(/Missing character/g) || []).length;
  // the references: biber's own errors live in the .blg; a citation it never resolved, in the log
  let blg = ''; try { blg = readFileSync(join(HERE, 'build', 'micro-manual.blg'), 'utf8'); } catch {}
  const biberErrors = (blg.match(/^ERROR - .*$/gm) || []);
  const undefinedCites = [...new Set((log.match(/Citation '[^']+'[^\n]*undefined/g) || []).map((m) => m.match(/'([^']+)'/)[1]))];
  if (biberErrors.length) console.log('pdf: biber —\n  ' + biberErrors.join('\n  '));
  if (undefinedCites.length) console.log('pdf: undefined citations — ' + undefinedCites.join(', '));
  if (errors || biberErrors.length || undefinedCites.length || r.status !== 0 && !existsSync(join(HERE, 'build', 'micro-manual.pdf'))) { console.log(`pdf: FAILED (${errors} errors, ${biberErrors.length} biber errors, ${undefinedCites.length} undefined citations) — see build/micro-manual.log`); process.exitCode = 1; }
  else console.log(`pdf: build/micro-manual.pdf  (overfull lines ${overfull}, missing glyphs ${missing})`);
}

// ── run ──
const { shots, data } = await readWanted();
if (want('data') || want('tools') || want('shots')) {
  const m = await startMicro();
  try {
    await openDemo(m.p);
    if (want('tools')) await phaseTools(m.p);
    if (want('data')) await phaseData(m.p, data);
    if (want('shots')) await phaseShots(m.p, shots);
  } finally { await m.close(); }
}
if (want('pdf')) phasePdf();
