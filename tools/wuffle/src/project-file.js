// wuffle — the project file, `<name>.zip.wuffle`: the /project tree, zipped (plus your /home files under
// home/). The files ARE the project — there is no hidden copy of the model beside them — so unzipping one
// gives plain CSV any tool reads, and a zip edited by hand opens as edited.
//
//   project.json                    format, name, and what a directory can't say: the ORDER of diagrams,
//                                   data and figures, the active diagram, which diagram a figure came from
//   data/<name>.csv · .json         the rows · kind, columns, roles, notation, lineage
//   diagrams/<name>/diagram.json    kind, props, and its layers in draw order
//   diagrams/<name>/layers/<l>.json the layer: which data ("data": "data/<name>.csv" — zip has no portable
//                                   symlinks; /project shows the same thing as a link), visibility, style
//   figures/<name>.compo.json       a figure page
//   selection/<name>.rows           the selected rows, 1-based (only data with a selection)
//   field/<name>/<log>.csv (+ .sig) an ORIGINAL — the compass's published log, BYTE FOR BYTE (its signature
//   field/<name>/photos/*.jpg       is over those exact bytes), and the station photos; the data read from
//                                   it lives in data/ like any other, edit that freely
//   home/…                          your files
//   layout.json                     how the desk was arranged (tabs, splits, floats), by diagram and figure
//                                   NAME — a view, not data: a project without one opens on the default
//
// Not stored: what is computed (svg, pdf, selection/<name>.csv) and the undo history.
// Pure: bytes in, bytes out (stored zip members — the page format gzips the whole thing; see page.js).

import { createZipStreamWriter, openZipRanged, bytesSource } from '../../../ext/archive/src/zipstream.js';
import { Project } from './model.js';
import { parseDelimited, readTable } from './io.js';
import { toCsv, layerBases, fileName as F } from './project-fs.js';

const json = (v) => JSON.stringify(v, null, 2) + '\n';
export const FORMAT = 'wuffle';
export const VERSION = 1;

/** the project (and home files [{ path, bytes }]) → { path → string | Uint8Array } */
export function projectEntries(p, { home = [], layout = null } = {}) {
  const out = new Map();
  out.set('project.json', json({ format: FORMAT, version: VERSION, name: p.name, active: p.diagram(p.activeDiagram)?.name || null,
    data: p.datasets.map((d) => d.name), diagrams: p.diagrams.map((g) => g.name),
    figures: p.figures.map((f) => ({ name: f.name, from: p.diagram(f.from)?.name || null })),
    ...(p.originals.length ? { field: p.originals.map((o) => ({ name: o.name, file: o.file })) } : {}) }));
  for (const d of p.datasets) {
    out.set(`data/${F(d.name)}.csv`, toCsv(d.columns, d.rows));
    out.set(`data/${F(d.name)}.json`, json({ name: d.name, kind: d.kind, columns: d.columns, roles: d.roles, notation: d.notation, lineage: d.lineage, meta: d.meta }));
  }
  for (const g of p.diagrams) {
    const ls = layerBases(p, g), dir = `diagrams/${F(g.name)}`;
    out.set(`${dir}/diagram.json`, json({ name: g.name, kind: g.kind, props: g.props, layers: ls.map((x) => x.base) }));
    for (const { l, base } of ls) {
      out.set(`${dir}/layers/${base}.json`, json({ data: `data/${F(p.dataset(l.datasetId).name)}.csv`, name: l.name, visible: l.visible, style: l.style, elements: l.elements }));
    }
  }
  for (const f of p.figures) out.set(`figures/${F(f.name)}.compo.json`, json(f.doc));
  for (const o of p.originals) {                          // byte for byte, as they came: a signature is over exact bytes
    const dir = `field/${F(o.name)}`;
    out.set(`${dir}/${F(o.file)}`, o.bytes);
    if (o.sig) out.set(`${dir}/${F(o.file)}.sig`, o.sig);
    for (const ph of o.photos) out.set(`${dir}/photos/${F(ph.name)}`, ph.bytes);
  }
  for (const d of p.datasets) { const s = p.selected(d.id); if (s.length) out.set(`selection/${F(d.name)}.rows`, s.map((i) => i + 1).join('\n') + '\n'); }
  if (layout) out.set('layout.json', json(layout));
  for (const h of home) {                                 // home files carry their VFS path: /home/notes.txt → home/notes.txt
    const rel = String(h.path).replace(/^\/+/, '');
    if (rel.startsWith('home/') && rel.length > 5) out.set(rel, h.bytes);
  }
  return out;
}

/** → Uint8Array, a .zip.wuffle */
export async function writeProject(p, opts) {
  const chunks = [];
  const zw = createZipStreamWriter({ write: async (b) => { chunks.push(b.slice()); } });
  for (const [path, data] of projectEntries(p, opts)) await zw.add(path, data);
  await zw.finish();
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** is this a wuffle project zip? (a zip whose project.json says so) */
export const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** a .zip.wuffle → { project, home: [{ path, bytes }], warnings: [] } — reads what is there, says what it skipped */
export async function readProject(bytes) {
  const z = await openZipRanged(bytesSource(bytes));
  const dec = new TextDecoder();
  const file = async (path) => { const e = z.entries.get(path); return e ? z.bytes(e) : null; };
  const text = async (path) => { const b = await file(path); return b ? dec.decode(b) : null; };
  const manifest = JSON.parse((await text('project.json')) || 'null');
  if (!manifest || manifest.format !== FORMAT) throw new Error('not a wuffle project (no project.json saying so)');
  const warnings = [];
  const p = new Project({ name: manifest.name || 'untitled' });
  const stem = (n, prefix, suffix) => n.slice(prefix.length, n.length - suffix.length);   // (suffix may be '')
  const listed = (prefix, suffix) => z.list().map((e) => e.name).filter((n) => n.startsWith(prefix) && n.endsWith(suffix) && stem(n, prefix, suffix) && !stem(n, prefix, suffix).includes('/'))
    .map((n) => stem(n, prefix, suffix));
  const ordered = (names, files) => [...names.map(F).filter((n) => files.includes(n)), ...files.filter((f) => !names.map(F).includes(f)).sort()];   // the manifest's order, then anything added by hand

  const dsByFile = new Map();
  for (const f of ordered(manifest.data || [], listed('data/', '.csv'))) {
    const meta = JSON.parse((await text(`data/${f}.json`)) || '{}');
    const t = parseDelimited(await text(`data/${f}.csv`));
    const columns = meta.columns && meta.columns.every((c) => t.columns.includes(c)) ? [...meta.columns, ...t.columns.filter((c) => !meta.columns.includes(c))] : t.columns;
    // a CSV added by hand, with no .json beside it: read its header the way File → Open does (one dataset —
    // a file the reader would split keeps its first reading here, so a layer naming it still finds it)
    const sniffed = meta.kind ? null : readTable(await text(`data/${f}.csv`), f.replace(/∕/g, '/'))[0];
    try {
      dsByFile.set(f, p.addDataset(sniffed ? { ...sniffed, name: f.replace(/∕/g, '/'), rows: t.rows, columns: t.columns }
        : { name: meta.name || f.replace(/∕/g, '/'), kind: meta.kind, rows: t.rows, columns, roles: meta.roles || {},
          notation: meta.notation || null, lineage: meta.lineage || null, meta: meta.meta || {} }));
    } catch (e) { warnings.push(`data/${f}.csv: ${e.message}`); }
  }
  const gByName = new Map();
  for (const f of ordered(manifest.diagrams || [], [...new Set(z.list().map((e) => e.name).filter((n) => n.startsWith('diagrams/') && n.endsWith('/diagram.json')).map((n) => n.slice(9, -13)))])) {
    const d = JSON.parse((await text(`diagrams/${f}/diagram.json`)) || 'null'); if (!d) continue;
    let gid;
    try { gid = p.addDiagram(d.kind || 'net', { name: d.name || f.replace(/∕/g, '/'), props: d.props }); } catch (e) { warnings.push(`diagrams/${f}: ${e.message}`); continue; }
    gByName.set(p.diagram(gid).name, gid);
    const bases = ordered(d.layers || [], listed(`diagrams/${f}/layers/`, '.json'));
    for (const b of bases) {
      const L = JSON.parse((await text(`diagrams/${f}/layers/${b}.json`)) || 'null'); if (!L) continue;
      const dataFile = String(L.data || '').replace(/^data\//, '').replace(/\.csv$/, '');
      const ds = dsByFile.get(dataFile);
      if (!ds) { warnings.push(`diagrams/${f}/layers/${b}.json: its data (${L.data}) isn't in the file`); continue; }
      const lid = p.addLayer(gid, ds, { style: L.style, elements: L.elements, name: L.name || null });
      if (L.visible === false) p.setLayerVisible(lid, false);
    }
  }
  const from = new Map((manifest.figures || []).map((x) => [F(x.name), x.from]));
  for (const f of ordered((manifest.figures || []).map((x) => x.name), listed('figures/', '.compo.json'))) {
    try { p.addFigure({ name: f.replace(/∕/g, '/'), doc: JSON.parse(await text(`figures/${f}.compo.json`)), from: gByName.get(from.get(f)) || null }); }
    catch (e) { warnings.push(`figures/${f}.compo.json: ${e.message}`); }
  }
  for (const [f, id] of dsByFile) {
    const t = await text(`selection/${f}.rows`); if (!t) continue;
    const n = p.dataset(id).rows.length, rows = t.split(/\s+/).filter(Boolean).map(Number).filter((r) => Number.isInteger(r) && r >= 1 && r <= n).map((r) => r - 1);
    if (rows.length) p.select(id, rows);
  }
  // originals: each field/<dir>/ holds one log (+ .sig, + photos/); the manifest gives its name and file, a
  // directory added by hand is read too (its one non-.sig file is the log)
  const fieldDirs = [...new Set(z.list().map((e) => e.name).filter((n) => n.startsWith('field/') && !n.endsWith('/')).map((n) => n.split('/')[1]))];
  const fmeta = new Map((manifest.field || []).map((x) => [F(x.name), x]));
  for (const dir of ordered((manifest.field || []).map((x) => x.name), fieldDirs)) {
    const m = fmeta.get(dir), inDir = listed(`field/${dir}/`, '');
    const logName = m?.file && inDir.includes(F(m.file)) ? F(m.file) : inDir.find((n) => !n.endsWith('.sig'));
    if (!logName) { warnings.push(`field/${dir}: no log in it`); continue; }
    const photos = [];
    for (const e of z.list()) if (e.name.startsWith(`field/${dir}/photos/`) && !e.dir) photos.push({ name: e.name.slice(`field/${dir}/photos/`.length), bytes: await z.bytes(e) });
    try { p.addOriginal({ name: m?.name || dir.replace(/∕/g, '/'), file: m?.file || logName, bytes: await file(`field/${dir}/${logName}`), sig: await file(`field/${dir}/${logName}.sig`), photos }); }
    catch (e) { warnings.push(`field/${dir}: ${e.message}`); }
  }
  if (manifest.active && gByName.has(manifest.active)) p.setActive(gByName.get(manifest.active));
  const home = [];
  for (const e of z.list()) if (e.name.startsWith('home/') && !e.dir) home.push({ path: '/' + e.name, bytes: await z.bytes(e) });
  // the arrangement: kept as it came (the desk drops what no longer fits); a broken one is just not used
  try { p.layout = JSON.parse((await text('layout.json')) || 'null'); } catch { p.layout = null; warnings.push('layout.json: not JSON — the default layout'); }
  p.clearHistory();
  return { project: p, home, warnings };
}
