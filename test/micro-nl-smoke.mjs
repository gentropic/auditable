// micro's PLAIN-LANGUAGE BAR in the real app — the demo project, the dev tree and then the
// BUILT micro.html. The accuracy is scored in Node (test/micro-nl.test.mjs); this guards the
// wiring and the safety properties, which only the app can show:
//   - ON by default, and still lazy: nothing trains until the bar is used
//   - the app's own description of the demo project is the evaluation's fixture (no drift)
//   - it PROPOSES and does NOT act: the filter box, the selection, the windows stay as they
//     were until the row runs — then the filter is the expression the row showed
//   - each new verb's proposal runs against the real functions (select, select-by-solid,
//     swath / stats / contact / factors / cross-tab windows, projection, export dialog)
//   - a phrase it does not know gets no proposal, and Alt+K says "not understood"
//   - ⌘K with a command NAME is untouched (the bar only answers when nothing matches)
// Run: node test/micro-nl-smoke.mjs  [--built-only | --dev-only]
import { chromium } from 'playwright';
import { installSmokeWaits } from './smoke-wait.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SESSION } from './micro-nl-corpus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

let pass = 0, fail = 0;
const chk = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`); ok ? pass++ : fail++; };
const browser = await chromium.launch({ args: [...(process.env.MICRO_CHROMIUM_ARGS || '--use-gl=angle').split(/\s+/).filter(Boolean)] });
await installSmokeWaits(browser);

const targets = [];
if (!process.argv.includes('--built-only')) targets.push(['dev', `/tools/micro/index.html`]);
if (!process.argv.includes('--dev-only') && fs.existsSync(path.join(root, 'micro.html'))) targets.push(['built', '/micro.html']);

for (const [tag, url] of targets) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { if (localStorage.getItem('micro.swRender') == null) localStorage.setItem('micro.swRender', 'off'); } catch { /* opaque origin */ } });   // CI draws on SwiftShader: keep software-rendering mode off
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e.message || e)));
  await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  await p.waitForFunction(() => !!window._micro, null, { timeout: 30000 });

  // ── on by default, lazy ──
  const cold = await p.evaluate(() => ({ stored: localStorage.getItem('micro.nl'), stats: window._micro.nlStats() }));
  await p.evaluate(() => window._micro.openDemoProject());
  await p.waitForFunction(() => window._micro.layers().length >= 7 && window._micro.layers().some((L) => L.label === 'ore shell'), null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  const lazy = await p.evaluate(() => window._micro.nlStats() == null);
  chk(`[${tag}] ON by default (nothing stored) and lazy — the demo opened without training the bar`, cold.stored === null && cold.stats == null && lazy);

  // ── the app's description of the demo == the evaluation's fixture ──
  const desc = await p.evaluate(() => window._micro.nlDescribeSession());
  const norm = (d) => JSON.stringify({ layers: d.layers.map((L) => ({ ...L, categories: [...(L.categories || [])].sort() })), groups: d.groups });
  chk(`[${tag}] the app describes the demo exactly as test/micro-nl-corpus.mjs DEMO_SESSION does`, norm(desc) === norm(DEMO_SESSION));
  if (norm(desc) !== norm(DEMO_SESSION)) console.log('   app:', JSON.stringify(desc));

  const r = await p.evaluate(async () => {
    const M = window._micro;
    const t0 = performance.now();
    await M.nlEnsureTrained();
    const ms = performance.now() - t0;
    const P = (q) => { const x = M.nlPropose(q); return x ? { title: x.title, name: x.name, expr: x.expr, args: x.args, run: x.run } : null; };
    const dep = M.layers().find((L) => L.name === 'deposit.csv');
    M.setActiveLayer(dep.id);
    const before = { filter: document.querySelector('#filter').value, sel: dep._selCount || 0, wins: document.querySelectorAll('.fwin').length };

    const head = P('blocks above 55 Fe in hematite');
    const props = {
      sel: P('select blocks with fe above 60'),
      solid: P('select inside the ore shell'),
      swath: P('swath of fe along x'),
      stats: P('estatísticas de fe por litologia'),
      contact: P('contact plot of fe'),
      factors: P('reconciliation factors'),
      xtab: P('cross-tab of iron by lithology'),
      proj: P('maximum intensity projection'),
      exp: P('export the rows'),
      hidePt: P('esconde a topografia'),
      colour: P('colorir por litologia'),
      junk: P('krige the gold into the model'),
      destroy: P('delete the block model'),
    };
    const after = { filter: document.querySelector('#filter').value, sel: dep._selCount || 0, wins: document.querySelectorAll('.fwin').length };

    // run the headline filter → the box holds the expression the row showed
    await head.run(); await new Promise((z) => setTimeout(z, 800));
    const filtered = { box: document.querySelector('#filter').value, mask: !!dep._filterMask };
    // select: filter → selection, the previous filter comes back
    await props.sel.run(); await new Promise((z) => setTimeout(z, 800));
    const selected = { n: dep._selCount || 0, box: document.querySelector('#filter').value };
    M.clearSelection && M.clearSelection();

    const wn = () => [...document.querySelectorAll('.fwin')].filter((w) => w.style.display !== 'none').map((w) => (w.querySelector('.fwin-head') || w).textContent);
    const opened = {};
    for (const k of ['swath', 'stats', 'contact', 'factors', 'xtab']) {
      const n0 = wn().length; props[k].run(); await new Promise((z) => setTimeout(z, 400));
      opened[k] = wn().filter((t) => !/grade-tonnage/.test(t)).slice(-1)[0] || '';
      opened[k + 'New'] = wn().length > n0;
    }
    M.closeAllWindows && M.closeAllWindows();
    props.proj.run(); const projOn = !!document.body && (M.renderer && true);
    props.solid.run(); await new Promise((z) => setTimeout(z, 300));
    const solidDlg = !!document.querySelector('#sbDlg.show');
    if (solidDlg) document.querySelector('#sbDlg').classList.remove('show');
    props.exp.run(); await new Promise((z) => setTimeout(z, 300));
    const exDlg = !!document.querySelector('#exDlg.show');
    if (exDlg) document.querySelector('#exDlg').classList.remove('show');
    const topo = M.layers().find((L) => L.label === 'topography');
    props.hidePt.run(); const topoHidden = topo && topo.visible === false;

    // a section lands where it was ASKED, in world coordinates (the slider is
    // frame-local: the bar once wrote world z into it and a cut at z 500 landed near 912, the top of the demo)
    const secIn = P('section at elevation 500'); await secIn.run(); await new Promise((z) => setTimeout(z, 200));
    const sec = { world: M.sectionWorld(), frameZ: (typeof M.frame === 'function' ? M.frame() : M.frame || {}).origin?.[2] ?? null };
    const secOut = P('section at elevation 1040'); await secOut.run(); await new Promise((z) => setTimeout(z, 200));
    sec.outMeta = document.querySelector('#meta').textContent; sec.outWorld = M.sectionWorld();
    const secX = P('north-south section at easting 613000'); await secX.run(); await new Promise((z) => setTimeout(z, 200));
    sec.x = M.sectionWorld(); sec.xMeta = document.querySelector('#meta').textContent;
    M.setSectionWorld({ mode: 'off' });

    // the palette: Alt+K says "not understood"; ⌘K with a command NAME is untouched
    M.openPalette({ nl: true });
    const typ = (v) => { const inp = document.querySelector('#palInput'); inp.value = v; inp.dispatchEvent(new Event('input')); };
    const rows = () => [...document.querySelectorAll('#palList .pal-item')].map((el) => el.textContent);
    typ('xyzzy plover frobnicate'); const notUnderstood = rows().some((t) => /not understood/.test(t));
    typ('swath of fe along x'); const nlRow = rows()[0] || '';
    M.closePalette();
    M.openPalette();
    typ('grade'); const cmdRows = rows(); M.closePalette();
    const strip = (o) => { const x = {}; for (const [k, v] of Object.entries(o)) x[k] = v && { title: v.title, name: v.name, expr: v.expr, args: v.args }; return x; };
    return { ms, before, after, head: head && { title: head.title, expr: head.expr }, props: strip(props), filtered, selected, opened, solidDlg, exDlg, topoHidden, sec, notUnderstood, nlRow, cmdRows, projOn };
  });
  chk(`[${tag}] trains on the demo in ${r.ms.toFixed(0)} ms`, r.ms < 15000);
  chk(`[${tag}] the headline row shows the expression: "${r.head && r.head.title}"`, r.head && r.head.expr === 'FE > 55 and LITO == "HEMATITE"' && r.head.title.includes('FE > 55 and LITO == "HEMATITE"'));
  chk(`[${tag}] PROPOSING does not act — filter / selection / windows unchanged by 13 proposals`, JSON.stringify(r.before) === JSON.stringify(r.after));
  chk(`[${tag}] Enter on the filter row → the box holds that expression and the model is masked`, r.filtered.box === 'FE > 55 and LITO == "HEMATITE"' && r.filtered.mask);
  chk(`[${tag}] select → a selection (${r.selected.n} blocks), the earlier filter back in the box ("${r.selected.box}")`, r.selected.n > 0 && r.selected.box === 'FE > 55 and LITO == "HEMATITE"');
  for (const [k, want] of [['swath', /swath/], ['stats', /stats/], ['contact', /contact/], ['factors', /factor|reconcil/i], ['xtab', /cross-tab/]])
    chk(`[${tag}] ${k}: "${r.props[k] && r.props[k].title}" opens its window ("${r.opened[k]}")`, !!r.props[k] && want.test(r.opened[k]));
  chk(`[${tag}] stats preset from pt: column FE, by LITO`, r.props.stats && r.props.stats.args.column === 'FE' && /by LITO/.test(r.props.stats.title));
  chk(`[${tag}] contact plot targets the drillholes ("${r.props.contact && r.props.contact.title}")`, r.props.contact && /demo_assay/.test(r.props.contact.title));
  chk(`[${tag}] select inside the ore shell → the select-by-solid dialog opens`, r.solidDlg);
  chk(`[${tag}] export the rows → the export dialog opens (nothing written)`, r.exDlg);
  chk(`[${tag}] pt: "esconde a topografia" hides the topography`, r.topoHidden);
  chk(`[${tag}] "section at elevation 500" cuts at z = 500 in world coordinates (got ${r.sec.world && r.sec.world.axis} ${r.sec.world && r.sec.world.position}; frame z origin ${r.sec.frameZ})`, r.sec.world && r.sec.world.axis === 'z' && Math.abs(r.sec.world.position - 500) < 0.01);
  chk(`[${tag}] "north-south section at easting 613000" cuts across X at 613000 (got ${r.sec.x && r.sec.x.axis} ${r.sec.x && r.sec.x.position}; ${r.sec.xMeta})`, r.sec.x && r.sec.x.axis === 'x' && Math.abs(r.sec.x.position - 613000) < 0.01);
  chk(`[${tag}] a section outside the data says so ("${r.sec.outMeta}") and sits at the data's edge (${r.sec.outWorld && r.sec.outWorld.position})`, /outside the data/.test(r.sec.outMeta) && r.sec.outWorld && r.sec.outWorld.position < 1040 && r.sec.outWorld.position > 800);
  chk(`[${tag}] pt: "colorir por litologia" → colour by LITO`, r.props.colour && r.props.colour.args.column === 'LITO');
  chk(`[${tag}] out of scope / destructive → no proposal`, r.props.junk == null && r.props.destroy == null);
  chk(`[${tag}] Alt+K: an unknown phrase says "not understood"; a known one leads with its proposal ("${r.nlRow.slice(0, 60)}")`, r.notUnderstood && /Swath of FE along X/.test(r.nlRow));
  chk(`[${tag}] ⌘K with a command name lists commands, no proposal row (${r.cmdRows.length} rows)`, r.cmdRows.length > 0 && !r.cmdRows.some((t) => /Enter to run/.test(t)));

  // ── the 2026-11-25 sweep: what the row says is what Enter does ──
  const r2 = await p.evaluate(async () => {
    const M = window._micro, H = window.micro, out = {}, meta = () => document.querySelector('#meta').textContent;
    const byLabel = (t) => M.layers().find((L) => (L.label || L.name) === t);
    const dep = byLabel('deposit.csv'), holes = byLabel('holes · demo_assay.csv');
    M.setActiveLayer(dep.id);
    // a background by NAME (setBg takes a hex: "white" did nothing)
    const bg = M.nlPropose('white background'); out.bgTitle = bg && bg.title;
    if (bg) await bg.run();
    try { out.bg = localStorage.getItem('micro.scene'); } catch { out.bg = null; }
    // "the drillholes" names the holes layer (it fell back to the active model)
    const fh = M.nlPropose('filter the drillholes to fe above 60'); out.fh = fh && fh.title;
    // a CATEGORY column: stats group by it; grade–tonnage proposes nothing
    const sb = M.nlPropose('stats by lithology'); out.sb = sb && { title: sb.title, col: sb.args.column || null };
    out.gtCat = M.nlPropose('grade tonnage of lithology');
    // a named layer the verb can't act on: nothing, rather than another layer's export
    out.expTopo = M.nlPropose('export the topography');
    // the project changes → the bar relearns before it proposes
    const X = [], Y = [], Z = [], CU = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { X.push(611900 + 10 * i); Y.push(7765000 + 10 * j); Z.push(700); CU.push(0.2 * (i + j)); }
    await H.addLayer({ kind: 'blocks', name: 'cu_model.csv', columns: { X, Y, Z, CU }, roles: { x: 'X', y: 'Y', z: 'Z' } });
    out.stale = M.nlStale();
    out.cuBefore = M.nlPropose('colour by cu');                 // stale: no proposal from the old vocabulary
    await M.nlEnsureTrained();
    const cu = M.nlPropose('colour by cu'); out.cu = cu && cu.title;
    // a select whose expression the named layer can't read selects NOTHING and puts the filter back
    M.setActiveLayer(holes.id);
    await H.filter(holes.id, 'FE > 60');
    const sel = M.nlPropose('select the drillholes with cu above 1'); out.selTitle = sel && sel.title;
    if (sel) await sel.run();
    await new Promise((z) => setTimeout(z, 300));
    out.sel = { count: holes._selCount || 0, filter: holes.filterExpr, meta: meta() };
    await H.filter(holes.id, '');
    // showing a layer whose group is hidden says why it stays hidden
    const hg = M.nlPropose('hide mining phases'); if (hg) await hg.run();
    const sp = M.nlPropose('show phase 1'); if (sp) await sp.run();
    out.showMeta = meta();
    const ug = M.nlPropose('show mining phases'); if (ug) await ug.run();
    // the empty bar's section example lies inside the data
    const st = M.nlStarters().map((x) => x.title).find((t) => /^section at elevation/.test(t));
    out.starter = st || null;
    // a thickness with no section says so; with a front half-space it becomes a slab of that thickness
    H.setSectionWorld ? null : null;
    M.setSectionWorld({ mode: 'off' });
    const t0 = M.nlPropose('make the section 20 meters thick'); if (t0) await t0.run();
    out.thickOff = meta();
    M.setSectionWorld({ axis: 'z', position: 600, clip: 'front' });
    const t1 = M.nlPropose('make the section 20 meters thick'); if (t1) await t1.run();
    const sw = M.sectionWorld(); out.thick = { clip: sw && sw.clip, thickness: sw && sw.thickness };
    M.setSectionWorld({ mode: 'off' });
    // the grade–tonnage preset drops a saved series' filter and unit when the column changes
    const keep = dep.analysis;
    dep.analysis = { gt: { series: [{ layer: 'deposit.csv', col: 'SG', filter: 'LITO == "HEMATITE"', unit: 't/m3' }] } };
    const cfg = M.nlSeriesCfg(dep, 'gt', 'FE').series[0];
    out.cfg = { col: cfg.col, filter: cfg.filter || null, unit: cfg.unit };
    dep.analysis = keep;
    return out;
  });
  chk(`[${tag}] "white background" → the scene turns white (${r2.bgTitle} → ${r2.bg})`, /white/.test(r2.bgTitle || '') && r2.bg === '#ffffff');
  chk(`[${tag}] "filter the drillholes to fe above 60" targets the holes ("${r2.fh}")`, /holes · demo_assay\.csv/.test(r2.fh || ''));
  chk(`[${tag}] "stats by lithology" groups by LITO, not a stats of LITO ("${r2.sb && r2.sb.title}", column ${r2.sb && r2.sb.col}); grade tonnage of a category proposes nothing (${r2.gtCat === null})`, r2.sb && /by LITO/.test(r2.sb.title) && r2.sb.col == null && r2.gtCat === null);
  chk(`[${tag}] "export the topography" (no table) proposes nothing, not another layer's export (${r2.expTopo === null})`, r2.expTopo === null);
  chk(`[${tag}] a new layer with CU: the bar is stale (${r2.stale}), proposes nothing until it relearns (${r2.cuBefore === null}), then "colour by cu" → "${r2.cu}"`, r2.stale === true && r2.cuBefore === null && /CU/.test(r2.cu || ''));
  chk(`[${tag}] "select the drillholes with cu above 1" (the holes have no CU) selects nothing and puts FE > 60 back (${JSON.stringify(r2.sel)})`, /CU > 1/.test(r2.selTitle || '') && r2.sel.count === 0 && r2.sel.filter === 'FE > 60' && /nothing selected/.test(r2.sel.meta));
  chk(`[${tag}] "show phase 1" inside a hidden group says why it stays hidden ("${r2.showMeta}")`, /hidden/.test(r2.showMeta) && /mining phases/.test(r2.showMeta));
  chk(`[${tag}] the empty bar's section example is inside the demo's data ("${r2.starter}")`, (() => { const z = r2.starter && +r2.starter.match(/(-?\d+(?:\.\d+)?)$/)[1]; return z >= 397.5 && z <= 912.05; })());
  chk(`[${tag}] a thickness with no section says so ("${r2.thickOff}"); on a front half-space it makes a 20 m slab (${JSON.stringify(r2.thick)})`, /no section/.test(r2.thickOff) && r2.thick.clip === 'slab' && Math.abs(r2.thick.thickness - 20) < 1e-9);
  chk(`[${tag}] the grade–tonnage preset for FE drops the saved SG series' filter and unit (${JSON.stringify(r2.cfg)})`, r2.cfg.col === 'FE' && r2.cfg.filter === null && r2.cfg.unit !== 't/m3');
  chk(`[${tag}] no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`, errors.length === 0);
  await ctx.close();
}

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
