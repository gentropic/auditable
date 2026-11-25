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
  chk(`[${tag}] no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`, errors.length === 0);
  await ctx.close();
}

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
