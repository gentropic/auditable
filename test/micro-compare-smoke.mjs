// micro smoke — MODEL VERSION COMPARISON: two versions of a block model → one composer page.
//   §1 the numbers: two synthetic models on one lattice with a KNOWN change — domain A's grade
//      +10 %, four blocks removed, four added — compared by domain × class at two cutoffs; the
//      table's old / new / Δ / Δ% equal a hand computation done here, in Node, from the same CSV
//   §2 the Δ map: the change category of every block (added / removed / changed / unchanged)
//      counted on the Δ layer itself, and the compatibility check's refusal for a shifted lattice
//   §3 the routine tool `comparemodels`: its values, a check expression over them, the routine
//      rules (stated cutoffs; an unknown setting names the nearest)
//   §4 the page: the dialog builds it — title, comparison table, map view, legend, biggest moves
//      (live {cmp:…} fields), lineage — and ↻ refresh computes it again after the new model changes
// Every number is checked against an answer worked out independently of micro.
// Run: node test/micro-compare-smoke.mjs (the dev tree) · --built (micro.html).
import { chromium } from 'playwright';
import { installSmokeWaits } from './smoke-wait.mjs';
import http from 'http';
import { readFile, mkdir } from 'fs/promises';
import { extname } from 'path';

const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-compare-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);

// ── the models: 10 × 10 × 4 blocks of 10 m at UTM offsets; DOMAIN A west (i < 5), B east;
// CLASS MEAS in the two lower levels, IND above; density 2.5 → 2500 t a block ──
const E0 = 512000, N0 = 7400000, Z0 = 300;
const auOf = (i, j, k) => +(0.5 + 0.1 * i + 0.05 * j + 0.2 * k).toFixed(3);
function model({ aFactor = 1, bFactor = 1, removed = () => false, added = [] } = {}) {
  const rows = [];
  for (let k = 0; k < 4; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
    if (removed(i, j, k)) continue;
    const dom = i < 5 ? 'A' : 'B', f = dom === 'A' ? aFactor : bFactor;
    rows.push({ i, j, k, dom, cls: k < 2 ? 'MEAS' : 'IND', au: f === 1 ? auOf(i, j, k) : +(auOf(i, j, k) * f).toFixed(4) });
  }
  for (const b of added) rows.push(b);
  const csv = 'XC,YC,ZC,AU,DOMAIN,CLASS\n' + rows.map((r) => `${E0 + 5 + 10 * r.i},${N0 + 5 + 10 * r.j},${Z0 + 5 + 10 * r.k},${r.au},${r.dom},${r.cls}`).join('\n') + '\n';
  return { rows, csv };
}
const OLD = model();
const ADDED = [0, 1].flatMap((i) => [0, 1].map((j) => ({ i, j, k: 4, dom: 'A', cls: 'IND', au: 1 })));
const NEW = model({ aFactor: 1.1, removed: (i, j) => i === 9 && j === 9, added: ADDED });
const NEW2 = model({ aFactor: 1.1, bFactor: 1.05, removed: (i, j) => i === 9 && j === 9, added: ADDED });   // the refresh: B moves too

// the hand computation: per cutoff × DOMAIN|CLASS, tonnes and grade·tonnes of the blocks at or above
const T = 2500, CUTS = [0, 1];
function sums(rows) {
  const m = new Map();
  for (const r of rows) for (const c of CUTS) {
    if (r.au < c) continue;
    const k = `${c}|${r.dom}|${r.cls}`, a = m.get(k) || { t: 0, tg: 0 };
    a.t += T; a.tg += T * r.au; m.set(k, a);
  }
  return m;
}
function hand(o, n) {
  const so = sums(o.rows), sn = sums(n.rows), keys = [...new Set([...so.keys(), ...sn.keys()])], out = {};
  for (const k of keys) {
    const a = so.get(k) || { t: 0, tg: 0 }, b = sn.get(k) || { t: 0, tg: 0 };
    out[k] = { ot: a.t, nt: b.t, om: a.tg, nm: b.tg, dm: b.tg - a.tg, dmp: a.tg ? (100 * (b.tg - a.tg)) / a.tg : NaN, og: a.t ? a.tg / a.t : NaN, ng: b.t ? b.tg / b.t : NaN };
  }
  const tot = { ot: 0, nt: 0, om: 0, nm: 0 };
  for (const [k, v] of Object.entries(out)) if (k.startsWith('0|')) { tot.ot += v.ot; tot.nt += v.nt; tot.om += v.om; tot.nm += v.nm; }
  tot.dmp = (100 * (tot.nm - tot.om)) / tot.om; tot.dtp = (100 * (tot.nt - tot.ot)) / tot.ot;
  tot.dgp = (100 * (tot.nm / tot.nt - tot.om / tot.ot)) / (tot.om / tot.ot);
  return { groups: out, tot };
}
const H1 = hand(OLD, NEW), H2 = hand(OLD, NEW2);
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const data = await readFile('.' + p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const b = await chromium.launch({ args: [...(process.env.MICRO_CHROMIUM_ARGS || '--use-gl=angle').split(/\s+/).filter(Boolean)] });
await installSmokeWaits(b);
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
let pass = 0, fail = 0;
const chk = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };
const mkPage = async () => {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  // after the first load, say WHY the page goes away if it does (a navigation, a renderer crash, a
  // download) — an intermittent "execution context was destroyed" on one GPU, 2026-11-25
  p.on('framenavigated', (fr) => { if (fr === p.mainFrame()) console.log('NAVIGATED', fr.url()); });
  p.on('crash', () => console.log('PAGE CRASHED (renderer)'));
  p.on('download', (d) => console.log('DOWNLOAD', d.suggestedFilename()));
  p.on('console', (m) => { if (/^STEP |context lost|CONTEXT_LOST|webgl/i.test(m.text()) || m.type() === 'error') console.log('CONSOLE', m.type(), m.text().slice(0, 160)); });
  p.on('close', () => console.log('PAGE CLOSED'));
  await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });
  return p;
};
const open = (p, files) => p.evaluate(async (fs) => { const M = window._micro; for (const [n, t] of fs) await M.openBlob(new File([t], n), n, 'add'); return M.layers().map((q) => q.name); }, files);
const P = { old: 'old.csv', new: 'new.csv', grade: 'AU', density: { const: 2.5 }, groupBy: ['DOMAIN', 'CLASS'], cutoffs: CUTS };

try {
  const p = await mkPage();
  await open(p, [['old.csv', OLD.csv], ['new.csv', NEW.csv]]);

  // ═══ §1 + §3 the numbers, through the routine tool ═══
  const t = await p.evaluate(async (P) => {
    const M = window._micro, res = await M.runTool('comparemodels', P);
    const scope = { cmp: res.values };
    return { table: res.table, values: res.values, layers: res.layers, gate5: M.routineEval('abs(cmp.delta_metal_pct) < 2', scope), gate10: M.routineEval('abs(cmp.delta_metal_pct) < 5', scope),
      routine: M.checkParams('comparemodels', { ...P, cutoffs: undefined }, { routine: true }).errors, typo: M.checkParams('comparemodels', { ...P, cutof: [0] }).errors };
  }, P);
  const col = (n) => t.table.columns.indexOf(n);
  let worst = 0, n = 0, missing = [];
  for (const r of t.table.rows) {
    const h = H1.groups[`${r[0]}|${r[1]}|${r[2]}`]; if (!h) { missing.push(r.slice(0, 3).join('|')); continue; }
    n++;
    for (const [c, v] of [['old_tonnes', h.ot], ['new_tonnes', h.nt], ['old_metal', h.om], ['new_metal', h.nm], ['delta_metal', h.dm], ['old_grade', h.og], ['new_grade', h.ng]]) {
      const got = r[col(c)];
      if (!(Number.isFinite(v) ? close(got, v) : !Number.isFinite(got))) { worst = Infinity; missing.push(`${r.slice(0, 3).join('|')} ${c} ${got} ≠ ${v}`); }
    }
    if (Number.isFinite(h.dmp) && !close(r[col('delta_metal_pct')], h.dmp)) missing.push(`${r.slice(0, 3).join('|')} Δ% ${r[col('delta_metal_pct')]} ≠ ${h.dmp}`);
  }
  chk(`the table: ${n} rows (cutoff × DOMAIN × CLASS) = the hand computation's ${Object.keys(H1.groups).length}, every old / new tonnes, grade, metal, Δ and Δ% equal${missing.length ? ' — ' + missing.slice(0, 4).join('; ') : ''}`, n === Object.keys(H1.groups).length && n === t.table.rows.length && !missing.length && worst === 0);
  const AIM = H1.groups['0|A|MEAS'];
  chk(`domain A, MEAS: grade +10 % exactly (Δ% ${(100 * (AIM.ng - AIM.og) / AIM.og).toFixed(6)}), tonnes unchanged (${AIM.ot} t both)`, close(t.table.rows.find((r) => r[0] === 0 && r[1] === 'A' && r[2] === 'MEAS')[col('delta_grade_pct')], 10) && AIM.ot === AIM.nt);
  const v = t.values;
  chk(`values at the lowest cutoff: metal ${v.old_metal.toFixed(3)} → ${v.new_metal.toFixed(3)} (Δ ${v.delta_metal_pct.toFixed(4)} %; by hand ${H1.tot.dmp.toFixed(4)} %), tonnes Δ ${v.delta_tonnes_pct.toFixed(4)} % (by hand ${H1.tot.dtp.toFixed(4)} %), grade Δ ${v.delta_grade_pct.toFixed(4)} %`,
    close(v.old_metal, H1.tot.om) && close(v.new_metal, H1.tot.nm) && close(v.delta_metal_pct, H1.tot.dmp) && close(v.delta_tonnes_pct, H1.tot.dtp) && close(v.delta_grade_pct, H1.tot.dgp) && v.old_tonnes === 400 * T && v.new_tonnes === 400 * T);
  chk(`a check over the values: abs(cmp.delta_metal_pct) < 2 → ${t.gate5} (by hand ${Math.abs(H1.tot.dmp) < 2}), < 5 → ${t.gate10} (by hand ${Math.abs(H1.tot.dmp) < 5})`, t.gate5 === Math.abs(H1.tot.dmp) < 2 && t.gate10 === Math.abs(H1.tot.dmp) < 5 && t.gate5 !== t.gate10);
  chk(`routine rules: a routine must state cutoffs (“${(t.routine[0] || '').slice(0, 50)}”); “cutof” → did you mean “cutoffs”`, t.routine.some((e) => /^cutoffs: a routine must state it/.test(e)) && t.typo.some((e) => /did you mean “cutoffs”/.test(e)));

  // ═══ §2 the Δ map: categories counted on the layer itself ═══
  const m = await p.evaluate(async (name) => {
    const M = window._micro, J = M.layers().find((q) => q.name === name), h = M.layerTableHeader(J), ci = h.columns.indexOf('change'), di = h.columns.findIndex((c) => c.startsWith('Δ'));
    const cnt = {}; let dmax = 0;
    for await (const { f } of M.layerRecords(J)) { cnt[f[ci]] = (cnt[f[ci]] || 0) + 1; if (f[di] !== '' && Math.abs(+f[di]) > dmax) dmax = Math.abs(+f[di]); }
    return { cnt, dmax, lin: J.lineage && J.lineage.op, cat: h.columns[h.mapping.cat] };
  }, t.layers[0]);
  chk(`the Δ layer ${t.layers[0]}: ${JSON.stringify(m.cnt)} = by hand added 4 · removed 4 · changed 200 (domain A) · unchanged 196 — and the values say the same (${v.added}/${v.removed}/${v.changed}/${v.unchanged})`,
    m.cnt.added === 4 && m.cnt.removed === 4 && m.cnt.changed === 200 && m.cnt.unchanged === 196 && v.added === 4 && v.removed === 4 && v.changed === 200 && v.unchanged === 196 && m.cat === 'change' && m.lin === 'reconcile');
  const amax = Math.max(...NEW.rows.filter((r) => r.dom === 'A' && r.k < 4).map((r) => Math.abs(r.au - auOf(r.i, r.j, r.k))));
  chk(`its Δ grade reaches ${m.dmax.toFixed(4)} = the largest +10 % by hand ${amax.toFixed(4)}`, Math.abs(m.dmax - amax) < 1e-5);
  // a lattice shifted by half a block: the table still compares, the map is refused with the check's reason
  const sh = await p.evaluate(async (csv) => {
    const M = window._micro; await M.openBlob(new File([csv], 'shifted.csv'), 'shifted.csv', 'add');
    const c = M.compareCompat(M.layers().find((q) => q.name === 'old.csv'), M.layers().find((q) => q.name === 'shifted.csv'));
    let err = null; try { await M.runTool('comparemodels', { old: 'old.csv', new: 'shifted.csv', grade: 'AU', density: { const: 2.5 }, cutoffs: [0] }); } catch (e) { err = e.message; }
    const tableOnly = await M.runTool('comparemodels', { old: 'old.csv', new: 'shifted.csv', grade: 'AU', density: { const: 2.5 }, cutoffs: [0], map: false });
    window.micro.removeLayer(M.layers().find((q) => q.name === 'shifted.csv').id);
    return { c, err, delta: tableOnly.values.delta_metal_pct, layers: tableOnly.layers || null };
  }, OLD.csv.replace(/^(\d+)/gm, (s) => String(+s + 5)));
  chk(`a lattice shifted half a block: refused for the map (“${(sh.err || '').slice(0, 90)}”), the table alone still compares (Δ metal ${sh.delta} %, no layer)`, !sh.c.ok && sh.err && sh.err.includes(sh.c.reason) && sh.delta === 0 && !sh.layers);

  // ═══ §4 the page, through the dialog; then ↻ refresh after the new model changes ═══
  const pg = await p.evaluate(async () => {
    const M = window._micro;
    const L = M.layers().find((q) => q.name === 'new.csv');
    const menu = (() => { const walk = (items) => items.flatMap((it) => [it.label, ...(Array.isArray(it.submenu) ? walk(it.submenu) : typeof it.submenu === 'function' ? walk(it.submenu()) : [])]); return walk(M.layerMenuSections(L, 100, 100)); })();
    const w = M.openCompareDialog({ newLayer: L });
    const q = (r) => w.el.querySelector(`[data-role=${r}]`);
    const ok = { old: q('old').value, new: q('new').value, grade: q('grade').value, domain: q('domain').value, cls: q('class').value, banner: w.el.querySelector('.pp-banner').textContent };
    q('densConst').value = '2.5'; q('cutoffs').value = '0, 1'; q('mapColor').value = 'change';
    const nFig = M.figures().length;
    w.el.querySelector('button[data-go]').click();
    for (let i = 0; i < 400 && M.figures().length === nFig; i++) await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 400 && document.body.contains(w.el); i++) await new Promise((r) => setTimeout(r, 50));
    const fig = M.currentFigure(), doc = fig.doc, env = { ...M.composerEnv({}), doc };
    const kinds = doc.frames.map((f) => `${f.kind}:${(f.source && f.source.kind) || ''}`);
    const tf = doc.frames.find((f) => f.source && f.source.kind === 'compare'), mv = doc.frames.find((f) => f.source && f.source.kind === 'compare-moves');
    const lin = doc.frames.find((f) => f.source && f.source.kind === 'compare-lineage');
    const view = doc.frames.find((f) => f.source && f.source.kind === 'view'), sl = view.source.scene.layers.filter((x) => x.visible);
    const field = (a) => env.fields.cmp(a, mv, env);
    return { menu: menu.includes('Compare model versions…'), cmd: !!M.COMMANDS.find((c) => c.id === 'compare'), ok, name: fig.name, kinds, rows: tf.content.rows.length, cols: tf.content.columns,
      dmp: field('delta_metal_pct'), group1: field('group1'), bench1: field('bench1'), blocks: field('blocks'), moves: mv.content.md, lin: lin.content.md,
      view: { layers: sl.map((x) => x.name), filter: sl[0] && sl[0].filter, color: sl[0] && sl[0].color, img: !!(view.content && view.content.src), ortho: view.content.meta && view.content.meta.ortho } };
  });
  chk(`offered: the new model's menu → Analyse → “Compare model versions…”, and the palette (compare)`, pg.menu && pg.cmd);
  chk(`the dialog guesses old ${pg.ok.old} · new ${pg.ok.new} · grade ${pg.ok.grade} · domain ${pg.ok.domain} · class ${pg.ok.cls}, and says “${pg.ok.banner}”`, pg.ok.old === 'old.csv' && pg.ok.new === 'new.csv' && pg.ok.grade === 'AU' && pg.ok.domain === 'DOMAIN' && pg.ok.cls === 'CLASS' && /same lattice/.test(pg.ok.banner));
  const want = ['text:compare-title', 'table:compare', 'text:compare-moves', 'text:compare-lineage', 'image:view', 'legend:legend', 'text:compare-maptitle'];
  chk(`the page “${pg.name}”: ${pg.kinds.join(', ')}`, want.every((k) => pg.kinds.includes(k)) && pg.kinds.length === want.length);
  chk(`its table: ${pg.rows} rows = the ${Object.keys(H1.groups).length} cutoff × group rows by hand + a total per cutoff, with the Δ columns`, pg.rows === Object.keys(H1.groups).length + CUTS.length && pg.cols.includes('Δ metal %'));
  chk(`live fields: {cmp:delta_metal_pct} = ${pg.dmp} (by hand ${H1.tot.dmp}); {cmp:blocks} “${pg.blocks}”`, close(pg.dmp, H1.tot.dmp) && /4 added · 4 removed · 200 changed · 196 unchanged/.test(pg.blocks));
  const big = Object.entries(H1.groups).filter(([k]) => k.startsWith('0|')).sort((a, b) => Math.abs(b[1].dm) - Math.abs(a[1].dm))[0];
  chk(`the biggest move by group: “${pg.group1}” = by hand ${big[0].slice(2).replace('|', ' · ')}; by bench: “${pg.bench1}”`, pg.group1.startsWith(big[0].slice(2).replace('|', ' · ') + ':') && /^bench 3\d\d/.test(pg.bench1) && /\{cmp:group1\}/.test(pg.moves));
  chk(`lineage names both files, their hashes and how they were made`, /old\.csv/.test(pg.lin) && /new\.csv/.test(pg.lin) && /opened/.test(pg.lin) && /[0-9a-f]{12}/.test(pg.lin));
  chk(`the map: the Δ layer alone (${pg.view.layers.join()}), unchanged filtered out (${pg.view.filter}), coloured by ${pg.view.color}, a plan from above (ortho), rendered`, pg.view.layers.length === 1 && /^compare_/.test(pg.view.layers[0]) && /unchanged/.test(pg.view.filter) && pg.view.color === 'change' && pg.view.img && pg.view.ortho);
  // the screenshot (LOOK at it): the composer window with the page
  try { await mkdir('experiments', { recursive: true }); await p.locator('.composer-win').screenshot({ path: `experiments/compare-report${BUILT ? '-built' : ''}.png` }); console.log(`     screenshot: experiments/compare-report${BUILT ? '-built' : ''}.png`); } catch (e) { console.log('     (no screenshot: ' + e.message + ')'); }

  // ↻ refresh: domain B moves +5 % in a new version of new.csv — the table, its fields and the map follow
  const rf = await p.evaluate(async (csv) => {
    const M = window._micro, fig = M.currentFigure();
    console.log('STEP remove');
    window.micro.removeLayer(M.layers().find((q) => q.name === 'new.csv').id);
    console.log('STEP open');
    await M.openBlob(new File([csv], 'new.csv'), 'new.csv', 'add');
    console.log('STEP refresh');
    const n = await M.refreshViews(fig);
    console.log('STEP done');
    const doc = fig.doc, env = { ...M.composerEnv({}), doc };
    const tf = doc.frames.find((f) => f.source && f.source.kind === 'compare'), mv = doc.frames.find((f) => f.source && f.source.kind === 'compare-moves');
    return { n, dmp: env.fields.cmp('delta_metal_pct', mv, env), changed: env.fields.cmp('changed', mv, env), unchanged: env.fields.cmp('unchanged', mv, env), stale: !!M.staleOf(tf),
      bmeas: tf.content.rows.find((r) => r[0] === '0' && r[1] === 'B' && r[2] === 'MEAS') };
  }, NEW2.csv);
  const bm = H2.groups['0|B|MEAS'];
  chk(`↻ refresh after the new model changed: {cmp:delta_metal_pct} ${rf.dmp} = by hand ${H2.tot.dmp} (was ${H1.tot.dmp}); the map recounted: ${rf.changed} changed, ${rf.unchanged} unchanged (by hand 396, 0); not stale`, close(rf.dmp, H2.tot.dmp) && rf.changed === 396 && rf.unchanged === 0 && !rf.stale && rf.n >= 3);
  chk(`… and the table row B · MEAS reads Δ grade ${rf.bmeas && rf.bmeas[8]} (by hand +${(100 * (bm.ng - bm.og) / bm.og).toFixed(1)} %)`, rf.bmeas && rf.bmeas[8] === `+${(100 * (bm.ng - bm.og) / bm.og).toFixed(1)} %`);
  // the routine tool makes the page too (figure:), with the map also in section; a second run makes it again, not twice
  const rt = await p.evaluate(async (P) => {
    const M = window._micro, n0 = M.figures().length;
    await M.runTool('comparemodels', { ...P, figure: 'monthly', section: true });
    const fig = M.figures().find((f) => f.name === 'monthly'), views = fig.doc.frames.filter((f) => f.source && f.source.kind === 'view');
    const secs = views.map((f) => { const s = f.content.meta && f.content.meta.facts && f.content.meta.facts.section; return s ? s.mode : 'none'; });
    await M.runTool('comparemodels', { ...P, figure: 'monthly', section: true });
    return { added: M.figures().length - n0, secs, again: M.figures().filter((f) => f.name.startsWith('monthly')).length, frames: fig.doc.frames.length };
  }, P);
  try { await p.evaluate(() => window._micro.openComposer('monthly')); await p.locator('.composer-win').screenshot({ path: `experiments/compare-report-section${BUILT ? '-built' : ''}.png` }); } catch { /* the screenshot is for a person to look at */ }
  chk(`the tool with figure: “monthly” — one page (${rt.added} new, ${rt.again} after a second run), its map in plan and in section (${rt.secs.join(', ')})`, rt.added === 1 && rt.again === 1 && rt.secs.join() === 'none,ew' && rt.frames === 8);
  await p.close();
} finally {
  await b.close(); server.close();
}
console.log(fail ? `FAIL — ${fail} failed, ${pass} passed` : `PASS — ${pass} checks`);
process.exit(fail ? 1 : 0);
