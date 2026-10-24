// micro × .wfr — the committed guard for the wireframe integration (promoted from
// experiments/verify-wfr-{import,convert,project}.mjs). Runs against the BUILT micro.html (the
// registry bundle is where a missing SPEC entry breaks the app) and the import arc on the dev tree.
//   import  — a multi-element .wfr → a layer group: resident mesh re-welded by vid with vertex
//             colours + vertex columns + checked topology; forced soup streams; lines → categorized
//             strings with records; points → pegs
//   convert — files never loaded as layers → one .wfr (PLY/OBJ/DXF → 5 elements); a 1 MB budget
//             spills to OPFS and writes byte-identical output, scratch cleared; the dialog flow;
//             layer export (vertex columns kept, PLY colours under the reserved color.* names;
//             a strings layer → lines only)
//   project — meshes/strings pack into meshes/*.wfr on save (one file per source), re-open in place
//             (ids, labels, visibility, colours), and a fresh page reloads each layer's element
// Run: node test/micro-wfr-smoke.mjs   (needs node build.js --target=micro first)
import { chromium } from 'playwright';
import http from 'http';
import { readFile, stat } from 'fs/promises';
import { extname } from 'path';
import { writeWfr } from '../ext/wireframe/index.js';

try { await stat('micro.html'); } catch { console.error('micro.html missing — run: node build.js --target=micro'); process.exit(1); }

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────
const o = [500000, 7400000, 300];
const P8 = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const V = Float64Array.from(P8.flatMap((p) => p.map((c, a) => o[a] + c * 10)));
const F = Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
const parts = [];
await writeWfr({ write: (b) => { parts.push(b.slice()); } }, {
  elements: [
    { name: 'cube', kind: 'triangles', positions: V, cells: F, topology: 'check', vertexAttributes: { 'color.r': Uint8Array.from({ length: 8 }, (_, i) => (i * 30) % 256), 'color.g': new Uint8Array(8).fill(40), 'color.b': new Uint8Array(8).fill(200) } },
    { name: 'strings', kind: 'lines', positions: new Float64Array([500000, 7400000, 300, 500005, 7400000, 300, 500010, 7400002, 300, 500000, 7400010, 310, 500006, 7400012, 312]), cells: Uint32Array.from([0, 1, 1, 2, 3, 4]), cellAttributes: { layer: ['PIT', 'PIT', 'ROAD'], line: Int32Array.of(0, 0, 1), seq: Int32Array.of(0, 1, 0), 'color.r': Uint8Array.of(255, 255, 0), 'color.g': Uint8Array.of(0, 0, 255), 'color.b': Uint8Array.of(0, 0, 0) } },
    { name: 'pegs', kind: 'points', positions: new Float64Array([500001, 7400001, 301, 500002, 7400003, 302, 500004, 7400004, 303]), vertexAttributes: { layer: ['A', 'B', 'A'] } },
  ],
});
const SCENE = [...Buffer.concat(parts.map((b) => Buffer.from(b)))];
function plyTerrain(n, rgb) {
  const w = n + 1, nv = w * w, nf = 2 * n * n;
  const hdr = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${nv}\nproperty double x\nproperty double y\nproperty double z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`);
  const vb = Buffer.alloc(nv * 27);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) { const k = j * w + i; vb.writeDoubleLE(612000 + i * 2, 27 * k); vb.writeDoubleLE(7300000 + j * 2, 27 * k + 8); vb.writeDoubleLE(400 + 15 * Math.sin(i / 9) * Math.cos(j / 13), 27 * k + 16); vb[27 * k + 24] = (i * 2) & 255; vb[27 * k + 25] = (j * 2) & 255; vb[27 * k + 26] = rgb; }
  const fb = Buffer.alloc(nf * 13); let f = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; for (const t of [[a, b, d], [a, d, c]]) { fb[13 * f] = 3; t.forEach((v, q) => fb.writeInt32LE(v, 13 * f + 1 + 4 * q)); f++; } }
  return [...Buffer.concat([hdr, vb, fb])];
}
const cubeAt = (org) => P8.map((p) => p.map((c, a) => org[a] + c * 10));
const QUADS = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
function dxfText({ org, layers, strings, peg }) {
  const c = cubeAt(org);
  let s = '0\nSECTION\n2\nENTITIES\n';
  QUADS.forEach((q, i) => { s += `0\n3DFACE\n8\n${layers[i < 3 ? 0 : 1]}\n62\n${i < 3 ? 1 : 5}\n`; q.forEach((v, k) => { s += `${10 + k}\n${c[v][0]}\n${20 + k}\n${c[v][1]}\n${30 + k}\n${c[v][2]}\n`; }); });
  for (const [L, n, dy] of strings) { s += `0\nPOLYLINE\n8\n${L}\n66\n1\n70\n8\n`; for (let i = 0; i < n; i++) s += `0\nVERTEX\n8\n${L}\n10\n${org[0] + i * 3}\n20\n${org[1] + 20 + dy}\n30\n${org[2] + 5 + i}\n70\n32\n`; s += '0\nSEQEND\n'; }
  if (peg) s += `0\nPOINT\n8\nPEGS\n10\n${org[0] + 1}\n20\n${org[1] + 1}\n30\n${org[2] + 1}\n`;
  return [...Buffer.from(s + '0\nENDSEC\n0\nEOF\n')];
}
const FX = {
  scene: SCENE, ply: plyTerrain(120, 120), plySmall: plyTerrain(40, 30),
  obj: [...Buffer.from('# two groups\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\ng floor\nf 1 2 3 4\ng wall\nf 1 2 5\n')],
  dxf: dxfText({ org: [610000, 7310000, 200], layers: ['ORE', 'WASTE'], strings: [['CREST', 5, 0]], peg: true }),
  pit: dxfText({ org: [612010, 7300010, 380], layers: ['ORE', 'ORE'], strings: [['CREST', 4, 0], ['TOE', 4, 6]], peg: false }),
};

// ── harness ───────────────────────────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const data = await readFile('.' + p); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const b = await chromium.launch({ args: ['--use-gl=angle'] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 750 }, acceptDownloads: true });
let ok = true; const chk = (n, c) => { console.log(`${c ? 'ok ' : 'FAIL'} ${n}`); ok = ok && c; };
async function page(url, proj) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
  await p.goto(BASE + url, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro, null, { timeout: 30000 });
  await p.evaluate(async ({ fx, proj }) => {
    const u = (a) => new Uint8Array(a);
    window.__fx = { scene: u(fx.scene), ply: new File([u(fx.ply)], 'terrain.ply'), plySmall: new File([u(fx.plySmall)], 'terrain.ply'), obj: new File([u(fx.obj)], 'parts.obj'), dxf: new File([u(fx.dxf)], 'pit.dxf'), pit: new File([u(fx.pit)], 'pit.dxf') };
    window._micro.setAutoOptimize('off');
    if (proj) window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(proj, { create: true });
  }, { fx: FX, proj });
  return p;
}

async function importArc(url, tag) {
  const p = await page(url);
  const r = await p.evaluate(async () => {
    const m = window._micro;
    await m.openBlob(new Blob([window.__fx.scene]), 'scene.wfr', 'replace');
    const Ls = m.layers(), mesh = Ls.find((L) => L.kind === 'mesh');
    const vd = await m.meshVertexData(mesh), vh = m.meshVertexHeader(mesh);
    const str = Ls.find((L) => L.docs.stringsDoc && L.docs.stringsDoc.header.kind === 'strings');
    const pegs = Ls.find((L) => L.docs.stringsDoc && L.docs.stringsDoc.header.kind === 'blockmodel');
    const out = {
      n: Ls.length, group: m.layerTree().some((nd) => nd.children && nd.children.length === 3),
      mesh: { tri: mesh.docs.meshDoc.header.triCount, v: mesh.docs.meshDoc.header.vertexCount, el: mesh.docs.meshDoc.header.element, colored: !!mesh.vertexColored, cols: vh.columns, red3: vd.attrs['color.r'][3], topo: mesh.docs.meshDoc.header.topology },
      str: { count: str.docs.stringsDoc.header.count, cats: str.docs.stringsDoc.header.categories, legend: str.catLegend && str.catLegend.entries.length, rec: str.docs.stringsDoc.fetchRecord(2) },
      pegs: { count: pegs.docs.stringsDoc.header.count, rec: pegs.docs.stringsDoc.fetchRecord(1) },
    };
    await m.openBlob(new Blob([window.__fx.scene]), 'scene.wfr', 'replace', null, { element: 'cube', forceSoup: true });
    const L0 = m.layers()[0];
    out.soup = { n: m.layers().length, soup: L0.docs.meshDoc.header.soup, tri: L0.docs.meshDoc.header.triCount };
    return out;
  });
  chk(`${tag} import: three elements → three layers in a group`, r.n === 3 && r.group);
  chk(`${tag} import: cube re-welded (12 tris / 8 vertices), vertex colours on the GPU path, color.* columns at their vid`, r.mesh.tri === 12 && r.mesh.v === 8 && r.mesh.el === 'cube' && r.mesh.colored && r.mesh.cols.includes('color.r') && r.mesh.red3 === 90);
  chk(`${tag} import: the checked topology travels with the layer`, r.mesh.topo && r.mesh.topo.closed === true && r.mesh.topo.status === 'checked');
  chk(`${tag} import: strings categorized by layer, authored colours → legend, records [layer, line, seq]`, r.str.count === 3 && JSON.stringify(r.str.cats) === '["PIT","ROAD"]' && r.str.legend === 2 && r.str.rec[0] === 'ROAD' && r.str.rec[1] === 1 && r.str.rec[2] === 0);
  chk(`${tag} import: pegs with layers and records`, r.pegs.count === 3 && r.pegs.rec[3] === 'B');
  chk(`${tag} import: element filter + forceSoup → one streamed layer`, r.soup.n === 1 && r.soup.soup === true && r.soup.tri === 12);
  await p.close();
}

async function convertArc(url, tag) {
  const p = await page(url);
  const ab = await p.evaluate(async () => {
    const m = window._micro, fx = window.__fx;
    const run = async (budget) => { const sink = m.wfr.partsSink(); const res = await m.wfr.runWfrJob({ sink, budget, sources: [{ files: [fx.ply] }, { files: [fx.obj] }, { files: [fx.dxf] }] }); return { res, bytes: new Uint8Array(await sink.blob().arrayBuffer()) }; };
    const a = await run(Infinity), s = await run(1024 * 1024);
    let same = a.bytes.length === s.bytes.length; for (let i = 0; same && i < a.bytes.length; i++) if (a.bytes[i] !== s.bytes[i]) same = false;
    let left = []; try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('wfr-scratch'); for await (const k of d.keys()) left.push(k); } catch { /* never created */ }
    await m.openBlob(new File([a.bytes], 'set.wfr'), 'set.wfr', 'replace');
    const t = m.layers().find((L) => L.docs.meshDoc && L.docs.meshDoc.header.element === 'terrain');
    return { els: a.res.manifest.elements.map((e) => [e.name, e.kind, e.counts.cells, e.counts.vertices]), spilled: s.res.stats.spilledBytes, same, left, opened: m.layers().length, colored: !!t.vertexColored };
  });
  chk(`${tag} convert: ply + obj + dxf → terrain, parts, pit, pit:strings, pit:points`, ab.els.map((e) => e[0]).join() === 'terrain,parts,pit,pit:strings,pit:points');
  chk(`${tag} convert: counts exact (28,800 / 14,641; obj fans to 3; dxf cube welded to 8)`, ab.els[0][2] === 28800 && ab.els[0][3] === 14641 && ab.els[1][2] === 3 && ab.els[2][2] === 12 && ab.els[2][3] === 8);
  chk(`${tag} convert: a 1 MB budget spills to OPFS and writes identical bytes; scratch cleared`, ab.spilled > 0 && ab.same && ab.left.length === 0);
  chk(`${tag} convert: the set opens as 5 layers, the PLY terrain coloured`, ab.opened === 5 && ab.colored);
  // the dialog: one file → download + open when done
  await p.evaluate(() => window._micro.openBlob(new Blob(['x,y,z\n1,2,3\n']), 'reset.csv', 'replace'));
  await p.evaluate(() => window._micro.openWfrDialog({ files: [window.__fx.ply] }));
  await p.waitForFunction(() => document.querySelector('#cwDlg').classList.contains('show') && /terrain\.ply/.test(document.querySelector('#cwDlgBody').textContent));
  await p.evaluate(() => { document.querySelector('#cwDlgBody select').value = 'download'; });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#cwGo')]);
  await p.waitForFunction(() => window._micro.layers().some((L) => L.name === 'terrain.wfr' && L.kind === 'mesh'), null, { timeout: 60000 });
  chk(`${tag} dialog: convert → download terrain.wfr → opened, dialog closed`, dl.suggestedFilename() === 'terrain.wfr' && !(await p.evaluate(() => document.querySelector('#cwDlg').classList.contains('show'))));
  const ex = await p.evaluate(async () => {
    const m = window._micro;
    await m.openBlob(window.__fx.ply, 'terrain.ply', 'replace');
    const sink = m.wfr.partsSink();
    const res = await m.wfr.runWfrJob({ sink, layers: [m.layers()[0]], budget: Infinity });
    await m.openBlob(new File([sink.blob()], 'out.wfr'), 'out.wfr', 'replace');
    const vd = await m.meshVertexData(m.layers()[0]);
    await m.openBlob(window.__fx.dxf, 'pit.dxf', 'replace', null, { asKind: 'lines' });
    const s2 = m.wfr.partsSink();
    const r2 = await m.wfr.runWfrJob({ sink: s2, layers: [m.layers()[0]], budget: Infinity });
    return { e: res.manifest.elements.map((x) => [x.counts.cells, x.counts.vertices, x.columns.map((c) => c.name).join('/'), x.meta.lineage && x.meta.lineage.op]), b0: vd.attrs['color.b'][0], s: r2.manifest.elements.map((x) => [x.kind, x.counts.cells, x.columns.map((c) => c.name).join('/')]) };
  });
  chk(`${tag} export: a PLY mesh layer → indexed, colours as color.r/g/b, lineage kept`, ex.e.length === 1 && ex.e[0][0] === 28800 && ex.e[0][1] === 14641 && ex.e[0][2] === 'color.r/color.g/color.b' && ex.e[0][3] === 'open' && ex.b0 === 120);
  chk(`${tag} export: a DXF strings layer → only its lines (layer + colour + line/seq order)`, ex.s.length === 1 && ex.s[0][0] === 'lines' && ex.s[0][1] === 4 && /layer/.test(ex.s[0][2]) && ['line', 'seq'].every((c) => ex.s[0][2].split('/').includes(c)));
  await p.close();
}

async function projectArc(url, tag) {
  const proj = 'wfrsmoke-' + tag;
  const clean = await page(url);
  await clean.evaluate(async (pr) => { try { await (await navigator.storage.getDirectory()).removeEntry(pr, { recursive: true }); } catch { /* fresh */ } }, proj);
  await clean.close();
  const p = await page(url, proj);
  const before = await p.evaluate(async () => {
    const m = window._micro;
    await m.openBlob(window.__fx.plySmall, 'terrain.ply', 'replace');
    await m.openBlob(window.__fx.pit, 'pit.dxf', 'add', null, { asKind: 'mesh' });
    await m.openBlob(window.__fx.pit, 'pit.dxf', 'add', null, { asKind: 'lines' });
    const Ls = m.layers(); Ls[1].label = 'pit surface'; Ls[2].visible = false;
    m.setAutoPack('on');
    return Ls.map((L) => [L.id, L.kind]);
  });
  p.evaluate(() => window._micro.saveProjectAs());
  await p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await p.evaluate(() => { const d = document.querySelector('#svDlg'); if (d.classList.contains('show')) document.querySelector('#svCopy').click(); });
  await p.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 120000 });
  const after = await p.evaluate(async (pr) => {
    const m = window._micro, Ls = m.layers();
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(pr);
    const files = []; for await (const k of (await dir.getDirectoryHandle('meshes')).keys()) if (/\.wfr$/.test(k)) files.push(k);
    const pj = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    m.setAutoPack('off');
    return { L: Ls.map((L) => [L.id, L.name, L.label || null, L.kind, L.storage, L.visible, (L.docs.meshDoc || L.docs.stringsDoc).header.element, L.lineage && L.lineage.op]), files: files.sort(), man: pj.layers.map((l) => [l.source, l.element]), colored: Ls.some((L) => L.vertexColored) };
  }, proj);
  chk(`${tag} project: save packs one .wfr per source (pit.wfr, terrain.wfr)`, JSON.stringify(after.files) === '["pit.wfr","terrain.wfr"]');
  chk(`${tag} project: layers re-open in place (ids, kinds, project storage, lineage "store")`, after.L.every((l, i) => l[0] === before[i][0] && l[3] === before[i][1] && /\.wfr$/.test(l[1]) && l[4] === 'project' && l[7] === 'store'));
  chk(`${tag} project: label + visibility kept, colours kept; the DXF's two layers share pit.wfr`, after.L[1][2] === 'pit surface' && after.L[2][5] === false && after.colored && after.L[1][1] === 'pit.wfr' && after.L[2][1] === 'pit.wfr');
  chk(`${tag} project: project.json names meshes/*.wfr + each layer's element`, after.man.every((l) => /^meshes\/.+\.wfr$/.test(l[0]) && l[1]));
  const q = await page(url, proj);
  await q.evaluate(async (pr) => { await window._micro.openProjectDir(await (await navigator.storage.getDirectory()).getDirectoryHandle(pr)); }, proj);
  await q.waitForFunction(() => window._micro.layers().length === 3 && window._micro.layers().every((L) => L.docs.meshDoc || L.docs.stringsDoc), null, { timeout: 60000 });
  const re = await q.evaluate(() => window._micro.layers().map((L) => [L.label || null, L.kind, L.visible, !!L.vertexColored, L.docs.stringsDoc ? L.docs.stringsDoc.header.categories : null, L.docs.meshDoc ? L.docs.meshDoc.header.triCount : L.docs.stringsDoc.header.count]));
  chk(`${tag} project: reload brings each layer back from its element`, re.length === 3 && re[0][3] && re[0][5] === 3200 && re[1][0] === 'pit surface' && re[1][5] === 12 && re[2][5] === 6 && JSON.stringify(re[2][4]) === '["CREST","TOE"]' && re[2][2] === false);
  await p.close(); await q.close();
}

await importArc('/micro.html', 'built');
await convertArc('/micro.html', 'built');
await projectArc('/micro.html', 'built');
await importArc('/tools/micro/index.html', 'dev');
await b.close(); server.close();
console.log(ok ? '\nMICRO WFR SMOKE: PASS' : '\nMICRO WFR SMOKE: FAIL');
process.exit(ok ? 0 : 1);
