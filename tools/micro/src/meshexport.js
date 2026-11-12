// micro — mesh and grid writers: a grid out as ESRI ASCII, meshes out as OBJ / PLY (merged
// when several are chosen), the .wfr convert / export dialog with its step and budget tables,
// and the Surfer display cache a big DEM reopens from. Every file leaves through
// deliverBlob (hostio.js).
import { gridFromGTiff } from '../../../ext/gtiff/index.js';
import { writeEsriAsc, writeSurferGrd } from './grid-io.js';
import { reReadMesh } from './records.js';
import { writeLFM } from '../../../ext/lfm/lfm.js';
import { writeMSH } from '../../../ext/condenser/src/main.js';
import { fmtSize, layerBytes, layerRelpath, resolveFileHandle } from './paths.js';
import { WFR_SOURCE_RE, baseName as wfrBase, handleSink, partsSink, runWfrJob } from './wfr-write.js';
import { openBlob } from './open.js';
import { detectDmWireframePairs } from './open-mesh.js';
import { shell } from '../../../ext/leadacid/index.js';
import { S, _fileHandles } from './state.js';
import { cacheStamp } from './project.js';
import { sourceHash } from './identity.js';
import { deliverBlob } from './hostio.js';
const $ = (s) => document.querySelector(s);

// export a grid layer as an ESRI ASCII .asc
export async function exportGridAsc(L) {
  const gd = L.docs.gridDoc; if (!gd) return;
  let g = gd.grid;
  if (gd.source && gd.source.g && !gd.fullRes) {           // display is decimated — export FULL res
    // was gated on `gd.level`, which is 0 (falsy) for a big single-level TIFF
    // decimated by step — exactly the common non-COG case, which therefore
    // exported the coarse display grid while claiming full resolution. And the
    // reload must decode the SELECTED band, not default to band 0.
    $('#meta').textContent = `${L.label || L.name} — decoding full resolution for export…`;
    try { g = await gridFromGTiff(gd.source.g, 0, gd.source.band || 0); } catch { g = gd.grid; }
  }
  if (!g) return;
  if (Math.abs(g.dx - g.dy) > g.dx * 1e-3) $('#meta').textContent = `note: non-square grid exported at cellsize ${g.dx}`;
  const blob = new Blob([writeEsriAsc(g)], { type: 'text/plain' });
  const name = (L.label || L.name).replace(/\.[^.]+$/, '') + '.asc';
  deliverBlob(blob, name);
  $('#meta').textContent = `exported ${name} (${g.nx}×${g.ny})`;
}

// ── MESH EXPORT — OBJ / PLY / MSH / LFM ──────────────────────────────────
// Geometry is re-read from each layer's source blob (reReadMesh → world-coord
// Float64 vertices), so what leaves is exactly what came in — no chunk
// quantization, no frame rebase. OBJ + LFM are multi-mesh (one named object
// per layer; LFM carries each layer's tint as the mesh colour); PLY + MSH are
// single-mesh formats, so multiple layers merge into one.
export function writeObjText(meshes) {
  const out = ['# micro — mesh export'];
  let off = 0;
  for (const m of meshes) {
    // both o AND g: importers disagree on which token splits meshes (older
    // CAD/mining readers key on g only and ignore o) — emitting both works everywhere
    const nm = (m.name || 'mesh').replace(/\s+/g, '_');
    out.push(`o ${nm}`, `g ${nm}`);
    const V = m.vertices, T = m.triangles;
    for (let i = 0; i < V.length; i += 3) out.push(`v ${V[i]} ${V[i + 1]} ${V[i + 2]}`);
    for (let t = 0; t < T.length; t += 3) out.push(`f ${off + T[t] + 1} ${off + T[t + 1] + 1} ${off + T[t + 2] + 1}`);
    off += V.length / 3;
  }
  out.push('');
  return out.join('\n');
}

// binary little-endian, DOUBLE coordinates — float32 loses ~0.5 m at UTM northings
export function writePlyMeshBytes(vertices, triangles) {
  const nv = vertices.length / 3, nf = triangles.length / 3;
  const hb = new TextEncoder().encode(
    `ply\nformat binary_little_endian 1.0\ncomment micro mesh export\nelement vertex ${nv}\n` +
    `property double x\nproperty double y\nproperty double z\n` +
    `element face ${nf}\nproperty list uchar uint vertex_indices\nend_header\n`);
  const bytes = new Uint8Array(hb.length + nv * 24 + nf * 13);
  bytes.set(hb);
  const dv = new DataView(bytes.buffer);
  let at = hb.length;
  for (let i = 0; i < vertices.length; i++) { dv.setFloat64(at, vertices[i], true); at += 8; }
  for (let t = 0; t < triangles.length; t += 3) {
    dv.setUint8(at, 3);
    dv.setUint32(at + 1, triangles[t], true); dv.setUint32(at + 5, triangles[t + 1], true); dv.setUint32(at + 9, triangles[t + 2], true);
    at += 13;
  }
  return bytes;
}

export function mergeMeshGeometry(meshes) {
  let nv = 0, nt = 0;
  for (const m of meshes) { nv += m.vertices.length; nt += m.triangles.length; }
  const V = new Float64Array(nv), T = new Uint32Array(nt);
  let vo = 0, to = 0, base = 0;
  for (const m of meshes) {
    V.set(m.vertices, vo);
    for (let i = 0; i < m.triangles.length; i++) T[to + i] = m.triangles[i] + base;
    base += m.vertices.length / 3; vo += m.vertices.length; to += m.triangles.length;
  }
  return { vertices: V, triangles: T };
}

export async function exportMeshes(Ls, fmt, fname) {
  const meshes = [];
  for (const L of Ls) {
    $('#meta').textContent = `reading ${L.label || L.name}…`;
    const m = await reReadMesh(L.docs.meshDoc);
    meshes.push({ name: (L.label || L.name).replace(/\.[^.]+$/, ''), vertices: m.vertices, triangles: Uint32Array.from(m.triangles), tint: L.tint });
  }
  let blob;
  if (fmt === 'obj') blob = new Blob([writeObjText(meshes)], { type: 'text/plain' });
  else if (fmt === 'lfm') {
    const hex2rgb = (h) => { const v = parseInt((h || '#9ea3a8').slice(1), 16); return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }; };
    blob = new Blob([await writeLFM({
      collectionName: fname.replace(/\.[^.]+$/, ''),
      meshes: meshes.map((m) => ({ name: m.name, colour: hex2rgb(m.tint), vertices: m.vertices, triangles: Int32Array.from(m.triangles) })),
    })]);
  } else {
    const g = meshes.length > 1 ? mergeMeshGeometry(meshes) : meshes[0];
    blob = fmt === 'ply'
      ? new Blob([writePlyMeshBytes(g.vertices, g.triangles)])
      : new Blob([await writeMSH({ arrays: {
          Location: { type: 'Double', components: 3, count: g.vertices.length / 3, data: g.vertices },
          Tri: { type: 'Integer', components: 3, count: g.triangles.length / 3, data: Int32Array.from(g.triangles) },
        } })]);
  }
  deliverBlob(blob, fname);
  const tris = meshes.reduce((s, m) => s + m.triangles.length / 3, 0);
  $('#meta').textContent = `exported ${fname} — ${Ls.length > 1 ? `${Ls.length} meshes, ` : ''}${tris.toLocaleString()} triangles (${fmtSize(blob.size)})`;
  return blob;
}

export const MESH_EXPORT_FMTS = [
  { id: 'obj', label: 'OBJ — Wavefront (text)', multi: 'named objects' },
  { id: 'lfm', label: 'LFM — Leapfrog model (colours)', multi: 'named meshes + colours' },
  { id: 'ply', label: 'PLY — binary, double precision', multi: 'merged into one mesh' },
  { id: 'msh', label: 'MSH — ARANZ / Leapfrog surface', multi: 'merged into one mesh' },
  { id: 'wfr', label: 'WFR — wireframe (bricked, attributes kept)', multi: 'named elements' },
];

export function openMeshExportDialog(Ls) {
  Ls = (Ls || []).filter((L) => L && L.kind === 'mesh' && L.docs.meshDoc);
  if (!Ls.length) return;
  const body = $('#meDlgBody'); body.textContent = '';
  const list = document.createElement('div'); list.className = 'me-list';
  list.textContent = Ls.map((L) => L.label || L.name).join(' · ');
  const sel = document.createElement('select');
  for (const f of MESH_EXPORT_FMTS) { const o = document.createElement('option'); o.value = f.id; o.textContent = f.label; sel.append(o); }
  const nameIn = document.createElement('input'); nameIn.type = 'text';
  const baseName = (Ls.length === 1 ? (Ls[0].label || Ls[0].name).replace(/\.[^.]+$/, '') : 'meshes');
  const note = document.createElement('div'); note.className = 'me-note';
  const sync = () => {
    const f = MESH_EXPORT_FMTS.find((x) => x.id === sel.value);
    nameIn.value = (nameIn.value.replace(/\.[^.]+$/, '') || baseName) + '.' + f.id;
    note.textContent = (Ls.length > 1 ? `${Ls.length} layers → ${f.multi}. ` : '') +
      (Ls.some((L) => L.docs.meshDoc.header.soup) ? 'streamed layers are fully re-read from their source to export. ' : '') +
      'world coordinates, full precision — exactly what the source file carries.';
  };
  nameIn.value = baseName + '.obj';
  sel.oninput = sync; sync();
  body.append(list, sel, nameIn, note);
  const close = () => { $('#meDlg').classList.remove('show'); $('#meGo').onclick = $('#meNot').onclick = $('#meCancel').onclick = null; };
  $('#meGo').onclick = async () => {
    const fmt = sel.value, fname = nameIn.value.trim() || baseName + '.' + fmt;
    close();
    if (fmt === 'wfr') return openWfrDialog({ layers: Ls });   // the .wfr job has its own options (step, budget, topology)
    try { await exportMeshes(Ls, fmt, fname); }
    catch (e) { $('#meta').textContent = `mesh export failed: ${e.message}`; }
  };
  $('#meNot').onclick = close;
  $('#meCancel').onclick = close;
  $('#meDlg').classList.add('show');
}

// ── .wfr: Convert (source files, never loaded) and Export (loaded layers) — one dialog, one job ──
// Sources stream through src/wfr-write.js into @gcu/wireframe's writer (bounded memory, spills to
// OPFS past the budget). Output goes to a file handle (streamed, never resident), the project's
// meshes/ folder, or a download / the shell's Downloads. "Open when done" loads the result.
export const wfrExportable = (L) => !!(L && L.docs && (L.docs.meshDoc || L.docs.stringsDoc));

export const WFR_STEPS = [['0.1 mm grid', 1e-4], ['1 mm grid', 1e-3], ['1 cm grid', 1e-2], ['lossless (float64)', null]];

export const WFR_BUDGETS = [['256 MB', 256], ['512 MB', 512], ['1 GB', 1024], ['2 GB', 2048]];

export let _wfrJob = null;                                         // { ctrl } while a job runs

export async function openWfrDialog({ files = null, layers = null } = {}) {
  const mode = layers ? 'export' : 'convert';
  let srcs = [];                                            // convert: [{ files:[…], name }]
  const Ls = (layers || []).filter(wfrExportable);
  const addFiles = async (fl) => {
    const ok = [...fl].filter((f) => WFR_SOURCE_RE.test(f.name));
    const { pairs, singles } = await detectDmWireframePairs(ok);
    for (const [pt, tr] of pairs) srcs.push({ files: [pt, tr], name: tr.name.replace(/(tr)?\.dm$/i, '') + '.dm' });
    for (const f of singles) if (!/\.dm$/i.test(f.name)) srcs.push({ files: [f], name: f.name });
    render();
  };
  $('#cwTitle').textContent = mode === 'export' ? 'export to .wfr' : 'convert to .wfr';
  $('#cwGo').textContent = mode === 'export' ? 'Export' : 'Convert';
  const body = $('#cwDlgBody'); body.textContent = '';
  const list = document.createElement('div'); list.className = 'cw-src';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Add files…'; addBtn.className = 'meta-act';
  const picker = document.createElement('input'); picker.type = 'file'; picker.multiple = true; picker.accept = '.ply,.obj,.dxf,.msh,.lfm,.dm,.wfr'; picker.style.display = 'none';
  picker.onchange = () => { addFiles(picker.files); picker.value = ''; };
  addBtn.onclick = () => picker.click();
  addBtn.style.alignSelf = 'flex-start';
  const grid = document.createElement('div'); grid.className = 'cw-grid';
  const field = (label, el) => { const l = document.createElement('label'); l.textContent = label; grid.append(l, el); return el; };
  const nameIn = field('output', Object.assign(document.createElement('input'), { type: 'text', spellcheck: false }));
  const dest = field('save to', document.createElement('select'));
  const canPick = typeof window.showSaveFilePicker === 'function' && !shell.present;
  const dests = [...(canPick ? [['file', 'a file on disk (streamed)']] : []), ...(S.project && S.project.dir && !S.project.pack ? [['project', `project ${S.project.name}/meshes/`]] : []), ['download', shell.present ? 'Downloads (shell)' : 'download']];
  for (const [v, t] of dests) dest.append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
  if (S.project && S.project.dir && !S.project.pack) dest.value = 'project';
  const step = field('coordinates', document.createElement('select'));
  WFR_STEPS.forEach(([t, v], i) => step.append(Object.assign(document.createElement('option'), { value: String(i), textContent: t })));
  const budget = field('memory', document.createElement('select'));
  for (const [t, v] of WFR_BUDGETS) budget.append(Object.assign(document.createElement('option'), { value: String(v), textContent: t }));
  budget.value = '512';
  const checks = document.createElement('div'); checks.className = 'cw-checks';
  const cb = (label, on) => { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = on; l.append(c, ' ' + label + '  '); checks.append(l); return c; };
  const topo = cb('verify topology', false);
  const openAfter = cb('open when done', mode === 'convert');
  const note = document.createElement('div'); note.className = 'cw-note';
  const render = () => {
    list.textContent = '';
    const items = mode === 'export' ? Ls.map((L) => ({ label: L.label || L.name, size: layerBytes ? layerBytes(L) : 0 })) : srcs.map((s) => ({ label: s.files.length === 2 ? `${s.files[0].name} + ${s.files[1].name}` : s.files[0].name, size: s.files.reduce((a, f) => a + f.size, 0), s }));
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'cw-row';
      const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: it.label });
      const sz = Object.assign(document.createElement('span'), { className: 'sz', textContent: it.size ? fmtSize(it.size) : '' });
      row.append(nm, sz);
      if (it.s) { const x = Object.assign(document.createElement('button'), { textContent: '×', title: 'remove' }); x.onclick = () => { srcs = srcs.filter((q) => q !== it.s); render(); }; row.append(x); }
      list.append(row);
    }
    if (!items.length) list.append(Object.assign(document.createElement('div'), { className: 'cw-note', textContent: mode === 'export' ? 'no exportable layers selected' : 'add .ply .obj .dxf .msh .lfm, Datamine pt/tr pairs, or .wfr files' }));
    if (!nameIn.dataset.touched) nameIn.value = (items.length === 1 ? wfrBase(items[0].label.split(' + ').pop()) : (mode === 'export' ? 'layers' : items.length ? wfrBase(items[0].label) + '-set' : 'converted')) + '.wfr';
    note.textContent = (mode === 'convert' ? 'Files are converted without loading them as layers. ' : 'Streamed layers are converted from their source. ')
      + 'Every element keeps world coordinates; the grid step is the precision (0.1 mm is finer than any survey). Memory past the budget spills to browser storage and is cleared afterwards.';
    $('#cwGo').disabled = !items.length;
  };
  nameIn.oninput = () => { nameIn.dataset.touched = '1'; };
  body.append(list, ...(mode === 'convert' ? [addBtn, picker] : []), grid, checks, note);
  const prog = $('#cwProg'), fill = $('#cwProgFill'), msg = $('#cwMsg');
  prog.style.display = 'none'; fill.style.width = '0%'; msg.textContent = '';
  const close = () => { if (_wfrJob) return; $('#cwDlg').classList.remove('show'); };
  $('#cwClose').onclick = close;
  $('#cwCancel').onclick = () => { if (_wfrJob) { _wfrJob.ctrl.abort(); msg.textContent = 'cancelling…'; } else close(); };
  $('#cwGo').onclick = async () => {
    if (_wfrJob) return;
    let fname = (nameIn.value.trim() || 'converted.wfr').replace(/[\\/]/g, '_');
    if (!/\.wfr$/i.test(fname)) fname += '.wfr';
    const st = WFR_STEPS[+step.value][1];
    const spec = { coords: st == null ? { mode: 'float64' } : { step: st }, ...(topo.checked ? { topology: 'check' } : {}) };
    let sink = null, handle = null;
    try {
      if (dest.value === 'file') {
        handle = await window.showSaveFilePicker({ suggestedName: fname, types: [{ description: 'wireframe mesh', accept: { 'application/vnd.gentropic.wireframe': ['.wfr'] } }] });
        fname = handle.name;
      } else if (dest.value === 'project') {
        const dir = await S.project.dir.getDirectoryHandle('meshes', { create: true });
        handle = await dir.getFileHandle(fname, { create: true });
      }
      sink = handle ? await handleSink(handle) : partsSink();
    } catch (e) { if (e && e.name === 'AbortError') return; msg.textContent = `can't write there: ${e.message || e}`; return; }
    const ctrl = new AbortController();
    _wfrJob = { ctrl };
    $('#cwGo').disabled = true; prog.style.display = '';
    const t0 = performance.now();
    try {
      const res = await runWfrJob({
        sink, spec, budget: +budget.value * 1024 * 1024, signal: ctrl.signal,
        sources: mode === 'convert' ? srcs : [], layers: mode === 'export' ? Ls : [],
        onProgress: (p) => {
          if (p.phase === 'reading') {
            const frac = (p.index + (p.total ? p.bytes / p.total : 0)) / Math.max(1, p.count);
            fill.style.width = `${Math.round(70 * frac)}%`;
            msg.textContent = `reading ${p.source}${p.total ? ` — ${Math.round(100 * p.bytes / p.total)}%` : '…'}`;
          } else { fill.style.width = '80%'; msg.textContent = 'sorting into bricks, writing…'; }
        },
      });
      await sink.close();
      fill.style.width = '100%';
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const els = res.manifest.elements;
      const file = handle ? await handle.getFile() : new File([sink.blob()], fname, { type: 'application/vnd.gentropic.wireframe' });
      msg.textContent = `${fname} — ${els.length} element${els.length === 1 ? '' : 's'}, ${fmtSize(res.size)}, ${secs} s`;
      $('#meta').textContent = `wrote ${fname} — ${els.map((e) => `${e.name}: ${(e.kind === 'points' ? e.counts.vertices : e.counts.cells).toLocaleString()} ${e.kind === 'triangles' ? 'triangles' : e.kind === 'lines' ? 'segments' : 'points'}`).join(' · ')} · ${fmtSize(res.size)} in ${secs} s`;
      if (!handle) await deliverBlob(file, fname);
      if (handle) { try { _fileHandles.set(file, handle); } catch { /* not a handle-tracking build */ } }
      _wfrJob = null;
      if (openAfter.checked) { $('#cwDlg').classList.remove('show'); await openBlob(file, fname, S.layers.length ? 'add' : 'replace'); }
    } catch (e) {
      if (sink) await sink.abort();
      if (handle && dest.value === 'project') { try { await (await S.project.dir.getDirectoryHandle('meshes')).removeEntry(handle.name); } catch { /* best effort */ } }
      msg.textContent = e && e.name === 'AbortError' ? 'cancelled — nothing written' : `failed: ${e.message || e}`;
      fill.style.width = '0%';
    } finally {
      _wfrJob = null; $('#cwGo').disabled = false;
    }
  };
  render();
  if (files) await addFiles(files);
  $('#cwDlg').classList.add('show');
}

// write the decimated display grid + a size-key as sidecars next to a
// project-stored tiff, so reopening skips re-decimating the source. Returns a
// reason string on skip, null on success.
export async function writeGridDisplayCache(L, dir) {
  const gd = L.docs.gridDoc;
  if (!gd || !gd.source || gd.fullRes) return 'no decimated display to cache';
  if (L.storage !== 'project') return 'grid must be copied into the project first';
  const g = gd.grid;
  if (g.nx > 32767 || g.ny > 32767) return 'display too large for the Surfer cache';
  const rel = await layerRelpath(L, dir);
  const gh = await resolveFileHandle(dir, rel + '.disp.grd', { create: true });
  let w = await gh.createWritable(); await w.write(writeSurferGrd(g)); await w.close();
  const jh = await resolveFileHandle(dir, rel + '.disp.json', { create: true });
  const stamp = await cacheStamp(dir, rel, gd.blob);
  const hash = (await sourceHash(gd.blob)) || undefined;
  w = await jh.createWritable(); await w.write(JSON.stringify({ v: 1, size: gd.blob.size, mtime: stamp, hash, nx: g.nx, ny: g.ny, band: (g.band || 0) })); await w.close();   // band is part of the identity: a multi-band GeoTIFF is ONE file size for every band
  return null;
}
