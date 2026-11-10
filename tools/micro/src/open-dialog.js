// micro — the OPEN dialog and the drillhole import dialog. Every UI open lands in the
// open dialog: a row per file with a load toggle, the size, real header detection, the
// X/Y/Z + colour/category mapping, "Open as", and the drillhole roles that assemble sets.
// The import dialog is the standalone three-slot form (File → Import drillholes…).
// Both end in the openers of src/open.js; the app wires the buttons.
import { census as xlsxCensus } from '../../../ext/sheet/index.js';
import { omfCensus } from './omf.js';
import { DXF_STREAM_BYTES, classifyDrillholeHeader, dmWireframeRole, mapColumns, parseLasHeader, parsePlyHeader, peekDmColumns, peekDxfHead, peekDxfScene, sniffDelimited } from '../../../ext/condenser/src/main.js';
import { isWfrName, openWfrBlob, summarizeElements } from './wfr-io.js';
import { readGTiff } from '../../../ext/gtiff/index.js';
import { MESH_STREAM_BYTES, openBlob, openDmWireframeBlob, openDrillholeLayer, openLfmSplit, openObjSplit, openWorkbook } from './open.js';
import { parquetInfoAsync } from '../../../ext/parquet/index.js';
import { S, _fileHandles, layerById } from './state.js';
import { basename, fmtSize } from './paths.js';
import { isBackupName } from './backup.js';
import { openPackFile } from './project.js';
import { createLayerGroup } from './tree.js';
import { closeAllLayers } from './layers.js';
const $ = (s) => document.querySelector(s);

// ── the OPEN dialog (every UI open lands here): a row per file — load toggle,
// size, real header detection (LAS/PLY headers + delimited sniff), per-file
// X/Y/Z + color/category mapping, load-as-points override, and the drillhole
// trio banner chaining into the import dialog. Programmatic opens (openBlob/
// openBlobs with explicit modes) bypass it. ──
export let _ofDlg = null;

export async function describeFile(f) {
  const name = f.name || 'file';
  if (/\.xlsx$/i.test(name)) {
    const d0 = { file: f, name, load: true, kind: 'xlsx', desc: 'Excel workbook', columns: null, mapping: null, forcePoints: false, dhRole: null };
    try {
      const cs = await xlsxCensus(f);
      const live = cs.sheets.filter((sh) => !sh.empty);
      d0.sheets = live.map((sh) => sh.name);
      d0.desc = `Excel workbook · ${live.length} sheet${live.length === 1 ? '' : 's'}${live.length ? ` · ${live[0].rows.toLocaleString()} rows in “${live[0].name}”` : ''} → table${live.length === 1 ? '' : 's'}`;
    } catch (e2) { d0.desc = `Excel workbook — ${e2.message}`; }
    return d0;
  }
  const d = { file: f, name, load: true, kind: 'unknown', desc: '', columns: null, mapping: null, forcePoints: /\.(xyz|pts)$/i.test(name), dhRole: null };
  try {
    if (/\.omf$/i.test(name)) {
      d.kind = 'omf';
      try {
        const els = await omfCensus(f);
        d.desc = `OMF project · ${els.length} element${els.length === 1 ? '' : 's'}: ` + els.map((e) => `${e.name} (${e.kind}${e.size ? ' ' + e.size : ''})`).join(', ') + ' → a layer each';
      } catch (e2) { d.desc = `OMF — ${e2.message}`; }
    } else if (/\.las$/i.test(name)) {
      const h = parseLasHeader(new DataView(await f.slice(0, 1024).arrayBuffer()));
      d.kind = 'las'; d.desc = `LAS ${h.version} fmt ${h.format} · ${Number(h.count).toLocaleString()} points`;
    } else if (isWfrName(name)) {
      // the directory + manifest only — a census without decoding a brick
      d.kind = 'wfr';
      try {
        const els = summarizeElements(await openWfrBlob(f));
        const word = { triangles: 'triangles', lines: 'segments', points: 'points' };
        d.desc = `wireframe · ${els.length} element${els.length === 1 ? '' : 's'}: ` + els.map((e) => `${e.name} (${(e.kind === 'points' ? e.vertices : e.cells).toLocaleString()} ${word[e.kind]})`).join(', ');
      } catch (e2) { d.desc = `wireframe — ${e2.message}`; }
    } else if (/\.ply$/i.test(name)) {
      const h = parsePlyHeader(new TextDecoder('latin1').decode(await f.slice(0, 64 * 1024).arrayBuffer()));
      const face = h && h.elements ? h.elements.find((e) => e.name === 'face') : null;
      d.plyFaces = face ? face.count : 0;
      d.kind = 'ply';
      d.desc = h ? `PLY ${h.format === 'ascii' ? 'ascii' : 'binary'} · ${h.count.toLocaleString()} vertices${d.plyFaces ? ` · ${d.plyFaces.toLocaleString()} faces → mesh` : ''}` : 'PLY';
    } else if (/\.(tif|tiff)$/i.test(name)) {
      d.kind = 'grid';
      try {
        const g = await readGTiff(f);
        const img = g.images[0];
        d.desc = `GeoTIFF · ${img.width.toLocaleString()}×${img.height.toLocaleString()} ${img.bitsPerSample}-bit${img.sampleFormat === 3 ? ' float' : ''}` +
          `${g.images.length > 1 ? ` · ${g.images.length - 1} overview${g.images.length > 2 ? 's' : ''}` : ''}${g.geo.crs ? ` · ${g.geo.crs}` : ''}`;
      } catch (e2) { d.desc = `GeoTIFF — ${e2.message}`; }
    } else if (/\.grd$/i.test(name)) {
      d.kind = 'grid';
      const tag = new TextDecoder('latin1').decode(await f.slice(0, 4).arrayBuffer());
      d.desc = tag === 'DSAA' ? 'Surfer grid (ascii)' : tag === 'DSBB' ? 'Surfer grid (binary)' : 'Surfer grid';
    } else if (/\.lfm$/i.test(name)) {
      d.kind = 'mesh';
      // the descriptor is XML before the binary — a head slice yields the
      // mesh census without touching the zlib streams
      let sampleLen = 256 * 1024, xml = '';
      for (;;) {
        xml = new TextDecoder('utf-8', { fatal: false }).decode(await f.slice(0, Math.min(sampleLen, f.size)).arrayBuffer());
        if (xml.includes('</leapfrogModelFile>') || sampleLen >= f.size) break;
        sampleLen *= 4;
      }
      const names = [...xml.matchAll(/<mesh>[\s\S]*?<name>([^<]*)<\/name>/g)].map((m2) => m2[1].trim()).filter(Boolean);
      // a split rewrites every mesh as its own in-memory .lfm child — fine for a
      // deliverable, not for a multi-hundred-MB model, which opens as ONE streamed mesh
      const bigLfm = f.size > 256 * 1024 * 1024;
      d.objGroups = bigLfm ? [] : names;
      d.split = !bigLfm && names.length > 1;
      d.desc = `Leapfrog model (.lfm)${names.length ? ` · ${names.length} mesh${names.length > 1 ? 'es' : ''}` : ''}${bigLfm ? ` · ${(f.size / 2 ** 30).toFixed(1)} GB · one streamed mesh` : ''}`;
    } else if (/\.dxf$/i.test(name)) {
      d.kind = 'dxf';
      d.desc = 'DXF drawing';
      if (f.size <= 32 * 1024 * 1024) {
        try {
          const c = await peekDxfScene(f);
          const parts = [];
          if (c.triangles) parts.push(`${c.triangles.toLocaleString()} faces → mesh`);
          if (c.strings) parts.push(`${c.strings.toLocaleString()} strings`);
          if (c.points) parts.push(`${c.points.toLocaleString()} points`);
          d.desc = `DXF drawing${parts.length ? ' · ' + parts.join(' · ') : ' (no 3D geometry)'}`;
          d.dxfInterps = [
            ...(c.triangles ? [['mesh', 'mesh (3DFACE surfaces)']] : []),
            ...(c.strings ? [['lines', 'design strings (capsules)']] : []),
            ...(c.points ? [['points', 'points (pegs)']] : []),
          ];
          d.dxfAs = d.dxfInterps.length ? d.dxfInterps[0][0] : null;
        } catch (e2) { d.desc = `DXF — ${e2.message}`; }
      } else if (f.size > DXF_STREAM_BYTES) {
        // too big to preview whole: describe what its HEAD holds; it opens streamed,
        // every kind in one pass unless one is picked
        try {
          const p = await peekDxfHead(f);
          const seen = [p.counts.triangles && 'faces', p.counts.strings && 'strings', p.counts.points && 'points'].filter(Boolean);
          d.desc = `DXF drawing · ${(f.size / 2 ** 30).toFixed(1)} GB · streamed${seen.length ? ` · starts with ${seen.join(' + ')}` : ''}`;
        } catch (e2) { d.desc = `DXF — ${e2.message}`; }
        d.dxfInterps = [['all', 'everything it holds (streamed)'], ['mesh', 'surface only'], ['lines', 'design strings only'], ['points', 'points only']];
        d.dxfAs = 'all';
      }
    } else if (/\.msh$/i.test(name)) {
      d.kind = 'mesh'; d.desc = 'Leapfrog mesh (.msh)';
    } else if (/\.obj$/i.test(name) && f.size > MESH_STREAM_BYTES) {
      // too big to read for a census (or to split — a split rewrites the file per
      // group): it opens as ONE streamed mesh
      d.kind = 'mesh';
      d.objGroups = []; d.split = false;
      d.desc = `Wavefront mesh (.obj) · ${(f.size / 2 ** 30).toFixed(1)} GB · one streamed mesh`;
    } else if (/\.obj$/i.test(name)) {
      d.kind = 'mesh';
      // group census (full read — context meshes are small): only groups that
      // actually own faces count; vertex indices are GLOBAL, so a split is
      // shared v-lines + each group's f-lines
      const text = await f.text();
      const groups = []; const seen = new Set();
      let cur = null, curHasFaces = false;
      for (const ln of text.split(/\r?\n/)) {
        const t = ln.trim();
        if (/^[go]\s/.test(t)) { cur = t.replace(/^[go]\s+/, '').trim() || 'group'; curHasFaces = false; }
        else if (/^f[\s]/.test(t)) {
          if (cur === null) { cur = 'default'; }
          if (!curHasFaces && !seen.has(cur)) { groups.push(cur); seen.add(cur); }
          curHasFaces = true;
        }
      }
      d.objGroups = groups;
      d.split = groups.length > 1;                         // default: split (a group keeps it tidy)
      d.desc = 'Wavefront mesh (.obj)' + (groups.length > 1 ? ` · ${groups.length} objects` : '');
    } else if (/\.dm$/i.test(name)) {
      const wf = dmWireframeRole(await peekDmColumns(f).catch(() => null));
      if (wf) { d.kind = 'dm-wireframe'; d.wfRole = wf; d.desc = `Datamine wireframe · ${wf} (pairs with its ${wf === 'points' ? 'triangles' : 'points'} file)`; }
      else { d.kind = 'dm'; d.desc = 'Datamine .dm block model'; }
    } else if (/\.(parquet|pq)$/i.test(name)) {
      d.kind = 'blocks';
      // the footer alone (range-read from the tail) yields the census — no
      // whole-file load just to preview a dropped parquet
      try {
        const info = await parquetInfoAsync(f);
        d.desc = `Parquet · ${info.rowCount.toLocaleString()} rows · ${info.columns.length} cols${info.codec ? ` · ${String(info.codec).toLowerCase()}` : ''}`;
      } catch (e2) { d.desc = `Parquet — ${e2.message}`; }
    } else {
      const sniff = sniffDelimited(await f.slice(0, 64 * 1024).text());
      d.kind = 'delimited';
      d.columns = sniff.header ? sniff.header.map((c) => String(c).trim()) : null;
      d.desc = d.columns ? `delimited · ${d.columns.length} cols` : `delimited · ${sniff.columns} cols, no header`;
      if (d.columns) {
        const cls = classifyDrillholeHeader(d.columns);
        if (cls) d.dhRole = cls.role;
        const map = mapColumns(d.columns);
        if (map) d.mapping = { ...map };
      }
    }
  } catch (e) { d.desc = `unreadable — ${e.message}`; d.load = false; }
  // valid "Open as" interpretations (grid-from-table isn't a provider yet, so
  // delimited/parquet don't offer grid). Drillhole roles arrive in stage 2b.
  d.interps = d.kind === 'xlsx' ? [['table', 'tables (one per sheet)']]
    : d.kind === 'ply' ? [['mesh', 'mesh'], ['points', 'points']]
    : d.kind === 'mesh' ? [['mesh', 'mesh']]
    : d.kind === 'dm-wireframe' ? [['wireframe', 'wireframe (mesh)']]
    : d.kind === 'grid' ? [['grid', 'grid']]
    : d.kind === 'dm' ? [['blocks', 'block model'], ['points', 'points']]
    : d.kind === 'las' ? [['points', 'points']]
    : d.kind === 'blocks' ? [['blocks', 'block model'], ['points', 'points']]
    : d.kind === 'delimited' ? [['blocks', 'block model'], ['points', 'points'], ['collar', 'DH collar'], ['survey', 'DH survey'], ['intervals', 'DH intervals']]
    : d.kind === 'dxf' ? (d.dxfInterps && d.dxfInterps.length ? d.dxfInterps : [['mesh', 'mesh (3DFACE surfaces)'], ['lines', 'design strings (capsules)'], ['points', 'points (pegs)']])
    : [['points', 'points']];
  d.asKind = d.kind === 'xlsx' ? 'table'
    : d.kind === 'ply' ? (d.plyFaces ? 'mesh' : 'points')
    : d.kind === 'dm-wireframe' ? 'wireframe'
    : d.kind === 'mesh' ? 'mesh' : d.kind === 'grid' ? 'grid' : d.kind === 'dm' ? 'blocks'
    : d.kind === 'las' ? 'points'
    : d.kind === 'delimited' ? (d.dhRole || (d.forcePoints ? 'points' : 'blocks'))
    : d.kind === 'blocks' ? (d.forcePoints ? 'points' : 'blocks')
    : d.kind === 'dxf' ? d.dxfAs                           // null when the peek couldn't run → the dominant pick at open
    : 'points';
  return d;
}

export let _dhSetSeq = 0;

// a fresh key for one drillhole set (the layers of a set share it)
export function nextDhSetKey() { return 'dhset:' + (++_dhSetSeq); }

// assemble drillhole sets from the open-dialog rows: group role-assigned files
// by set index → { collar, survey, intervals[] }. Multi-interval + multi-set.
export function assembleDhSets(rows) {
  const bySet = new Map();
  for (const r of rows) {
    if (!r.load || !['collar', 'survey', 'intervals'].includes(r.asKind)) continue;
    const s = r.setIdx || 0;
    if (!bySet.has(s)) bySet.set(s, { idx: s, collar: null, survey: null, intervals: [] });
    const set = bySet.get(s);
    if (r.asKind === 'intervals') set.intervals.push(r); else set[r.asKind] = r;
  }
  return [...bySet.values()].sort((a, b) => a.idx - b.idx);
}

export const dhSetComplete = (s) => !!(s.collar && s.survey && s.intervals.length);

// load a set as one dh layer per interval table, all sharing the same collar +
// survey (a _setKey groups them → one .holes.json with intervals[] at save).
// Column mappings are sniffed here and editable afterward in the source tab.
export async function loadDrillholeSet(set, cfg, replaceFirst) {
  const key = nextDhSetKey();
  const ids = [];
  let first = replaceFirst;
  for (const iv of set.intervals) {
    const _got = await openDrillholeLayer({ collar: set.collar.file, survey: set.survey.file, intervals: iv.file }, { method: cfg.method || 'minimumCurvature', dipConvention: cfg.dip || 'auto' }, first ? 'replace' : 'add');
    const L = layerById(_got);
    if (L) { L._setKey = key; L._intervalName = iv.name; ids.push(L.id); }
    first = false;
  }
  // multiple interval tables → nest the siblings under a parent group (the set);
  // reopen restores it via the saved tree, so only group at initial load
  if (ids.length) createLayerGroup(dhGroupName(set.collar.name), ids, { collapsed: false, dhSet: true });   // ALWAYS a set group — the group IS the element
}

// a readable set/group name from the collar filename (drop a trailing _collar(s))
export const dhGroupName = (collarName) => basename(String(collarName)).replace(/\.[^.]+$/, '').replace(/[_-]?collars?$/i, '') || 'drillholes';

export async function openFilesDialog(files) {
  const bk = files.filter((f) => isBackupName(f.name));
  if (bk.length) { await openPackFile(bk[0]); files = files.filter((f) => !isBackupName(f.name)); if (!files.length) return; }
  const rows = [];
  for (const f of files) rows.push(await describeFile(f));
  _ofDlg = { rows, dhCfg: {}, mode: S.layers.length ? 'add' : 'replace' };
  renderOfDialog();
  $('#ofDlg').classList.add('show');
}

export function renderOfDialog() {
  const body = $('#ofDlgBody');
  body.textContent = '';
  const rows = _ofDlg.rows;
  const isRole = (k) => k === 'collar' || k === 'survey' || k === 'intervals';
  const collarCount = rows.filter((r) => r.load && r.asKind === 'collar').length;
  const showSets = collarCount >= 2;                       // reveal set selectors only when 2+ collars
  const mkSplitToggle = (r) => {
    if (!r.objGroups || r.objGroups.length < 2) return null;
    const lab = document.createElement('label');
    const cb2 = document.createElement('input'); cb2.type = 'checkbox'; cb2.checked = r.split !== false;
    cb2.onchange = () => { r.split = cb2.checked; };
    lab.append(cb2, ` split into ${r.objGroups.length} solids (as a group)`);
    lab.title = r.objGroups.join(' · ');
    return lab;
  };
  for (const r of rows) {
    const row = document.createElement('div'); row.className = 'dh-row' + (r.load && isRole(r.asKind) ? ' of-dh' : '');
    const head = document.createElement('div'); head.className = 'dh-head';
    const eye = document.createElement('input'); eye.type = 'checkbox'; eye.checked = r.load;
    eye.onchange = () => { r.load = eye.checked; renderOfDialog(); };
    const nm = document.createElement('b'); nm.textContent = r.name; nm.style.width = 'auto'; nm.style.flex = '1';
    nm.style.overflow = 'hidden'; nm.style.textOverflow = 'ellipsis'; nm.style.whiteSpace = 'nowrap';
    const sz = document.createElement('span'); sz.className = 'dh-file'; sz.style.flex = '0 0 auto';
    sz.textContent = fmtSize(r.file.size);
    const desc = document.createElement('span'); desc.className = 'dh-file'; desc.style.flex = '0 1 auto';
    desc.textContent = r.desc;
    head.append(eye, nm, sz, desc);
    row.appendChild(head);
    if (r.load && r.interps && r.interps.length > 1) {
      const asRow = document.createElement('div'); asRow.className = 'dh-maps';
      const wrap = document.createElement('label'); wrap.append('Open as ');
      const sel = document.createElement('select');
      for (const [v, lbl] of r.interps) { const o = document.createElement('option'); o.value = v; o.textContent = lbl; sel.appendChild(o); }
      sel.value = r.asKind;
      sel.onchange = () => { r.asKind = sel.value; r.forcePoints = sel.value === 'points'; renderOfDialog(); };
      wrap.appendChild(sel); asRow.appendChild(wrap);
      if (showSets && isRole(r.asKind)) {                  // which drillhole set this role belongs to
        const setW = document.createElement('label'); setW.append(' set ');
        const ss = document.createElement('select');
        for (let i = 0; i < Math.max(collarCount, (r.setIdx || 0) + 1); i++) { const o = document.createElement('option'); o.value = String(i); o.textContent = String(i + 1); ss.appendChild(o); }
        ss.value = String(r.setIdx || 0);
        ss.onchange = () => { r.setIdx = +ss.value; renderOfDialog(); };
        setW.appendChild(ss); asRow.appendChild(setW);
      }
      row.appendChild(asRow);
    }
    // X/Y/Z mapping only for a delimited file opened as blocks/points (drillhole
    // role mappings are sniffed and editable afterward in the source tab)
    if (r.load && r.kind === 'delimited' && r.columns && (r.asKind === 'blocks' || r.asKind === 'points')) {
      const maps = document.createElement('div'); maps.className = 'dh-maps';
      const mkSel = (key, label) => {
        const wrap = document.createElement('label');
        wrap.append(label + ' ');
        const sel = document.createElement('select');
        r.columns.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c; sel.appendChild(o); });
        const cur = r.mapping && r.mapping[key] != null && r.mapping[key] >= 0 ? r.mapping[key] : 0;
        sel.value = String(cur);
        r.mapping = r.mapping || {}; if (r.mapping[key] == null || r.mapping[key] < 0) r.mapping[key] = 0;
        sel.onchange = () => { r.mapping = r.mapping || {}; r.mapping[key] = +sel.value; };
        wrap.appendChild(sel);
        return wrap;
      };
      maps.append(mkSel('x', 'X'), mkSel('y', 'Y'), mkSel('z', 'Z'));
      row.appendChild(maps);
    }
    { const st2 = mkSplitToggle(r); if (st2) { const w2 = document.createElement('div'); w2.className = 'dh-maps'; w2.appendChild(st2); row.appendChild(w2); } }
    body.appendChild(row);
  }
  // drillhole set summary — one banner per assembled set (collar + survey + N
  // interval tables), with the desurvey config right there
  for (const set of assembleDhSets(rows)) {
    const banner = document.createElement('div'); banner.className = 'of-banner';
    const complete = dhSetComplete(set), ivN = set.intervals.length, tag = assembleDhSets(rows).length > 1 ? ` ${set.idx + 1}` : '';
    const label = document.createElement('span');
    label.textContent = complete
      ? ` drillhole set${tag}: collar + survey + ${ivN} interval table${ivN > 1 ? 's' : ''}`
      : ` drillhole set${tag} incomplete — need ${!set.collar ? 'collar ' : ''}${!set.survey ? 'survey ' : ''}${!set.intervals.length ? 'intervals' : ''}`;
    banner.appendChild(label);
    if (complete) {
      const cfg = _ofDlg.dhCfg[set.idx] = _ofDlg.dhCfg[set.idx] || { method: 'minimumCurvature', dip: 'auto' };
      const mW = document.createElement('label'); mW.append(' desurvey ');
      const mSel = document.createElement('select');
      for (const [v, t] of [['minimumCurvature', 'min-curv'], ['balancedTangential', 'bal-tan'], ['tangential', 'tangential']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; mSel.appendChild(o); }
      mSel.value = cfg.method; mSel.onchange = () => { cfg.method = mSel.value; };
      mW.appendChild(mSel);
      const dW = document.createElement('label'); dW.append(' dip ');
      const dSel = document.createElement('select');
      for (const [v, t] of [['auto', 'auto'], ['pos-down', 'pos-down'], ['neg-down', 'neg-down']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; dSel.appendChild(o); }
      dSel.value = cfg.dip; dSel.onchange = () => { cfg.dip = dSel.value; };
      dW.appendChild(dSel);
      banner.append(mW, dW);
    }
    body.appendChild(banner);
  }
  const modeRow = document.createElement('div'); modeRow.className = 'of-mode';
  for (const [v, label] of [['add', 'add to the view'], ['replace', 'replace the view']]) {
    const lab = document.createElement('label');
    const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'ofMode';
    rb.checked = _ofDlg.mode === v; rb.disabled = v === 'add' && !S.layers.length;
    rb.onchange = () => { _ofDlg.mode = v; };
    lab.append(rb, ' ' + label);
    modeRow.appendChild(lab);
  }
  body.appendChild(modeRow);
}

// pair Datamine wireframe halves (points + triangles) among the dialog rows,
// preferring the same <base>pt/<base>tr base name (mirrors assembleDhSets).
export function assembleWireframePairs(rows) {
  const wf = rows.filter((r) => r.load && r.kind === 'dm-wireframe' && r.asKind === 'wireframe');
  const pts = wf.filter((r) => r.wfRole === 'points'), trs = wf.filter((r) => r.wfRole === 'triangles');
  const pairs = [], used = new Set();
  const baseOf = (n) => n.replace(/\.dm$/i, '').replace(/(pt|tr)$/i, '');
  for (const pt of pts) {
    const b = baseOf(pt.name);
    const tr = trs.find((t) => !used.has(t) && baseOf(t.name) === b) || trs.find((t) => !used.has(t));
    if (tr) { pairs.push({ pt, tr }); used.add(pt); used.add(tr); }
  }
  const wfFiles = new Set(wf.map((r) => r.file)), pairFiles = new Set([...used].map((r) => r.file));
  return { pairs, wfFiles, pairFiles, unpaired: wf.length - used.size };
}

// the dialog's Open button
export async function ofConfirm() {
  const st = _ofDlg;
  $('#ofDlg').classList.remove('show');
  if (!st) return;
  const sets = assembleDhSets(st.rows).filter(dhSetComplete);
  const inSet = new Set();                                 // files consumed by a drillhole set
  for (const s of sets) { inSet.add(s.collar.file); inSet.add(s.survey.file); for (const iv of s.intervals) inSet.add(iv.file); }
  const wire = assembleWireframePairs(st.rows);            // Datamine wireframe pt/tr pairs
  // non-compound rows: everything loaded that isn't a drillhole role or a wireframe half
  const toLoad = st.rows.filter((r) => r.load && !inSet.has(r.file) && !wire.wfFiles.has(r.file) && !['collar', 'survey', 'intervals'].includes(r.asKind));
  if (st.mode === 'replace') closeAllLayers();
  let first = st.mode === 'replace' || !S.layers.length;
  for (const { pt, tr } of wire.pairs) { await openDmWireframeBlob(pt.file, tr.file, first ? 'replace' : 'add'); first = false; }
  for (const r of toLoad) {
    const over = {};
    if (r.mapping && r.kind === 'delimited') over.mapping = { x: r.mapping.x ?? 0, y: r.mapping.y ?? 1, z: r.mapping.z ?? 2, chan: r.mapping.chan ?? null, cat: r.mapping.cat ?? null };
    if (r.asKind) over.asKind = r.asKind;
    if (r.objGroups && r.objGroups.length > 1 && r.split !== false) {
      if (/\.lfm$/i.test(r.name)) await openLfmSplit(r.file, r.name, first ? 'replace' : 'add');
      else await openObjSplit(r.file, r.name, first ? 'replace' : 'add');
    } else if (/\.xlsx$/i.test(r.name)) {
      await openWorkbook(r.file, r.name, first ? 'replace' : 'add');
    } else await openBlob(r.file, r.name, first ? 'replace' : 'add', null, over);
    first = false;
  }
  for (const set of sets) { await loadDrillholeSet(set, st.dhCfg[set.idx] || {}, first); first = false; }
  if (wire.unpaired) $('#meta').textContent = `note: ${wire.unpaired} Datamine wireframe file(s) had no matching pt/tr partner — open both halves together to view the mesh`;
  _ofDlg = null;
}

export function ofCancel() { $('#ofDlg').classList.remove('show'); _ofDlg = null; }

// ── the import dialog: three slots + mappings + method — File → Import
// drillholes…, or offered when a dropped batch sniffs as a trio ──
export let _dhDlg = null;

export function openDhDialog(trio) {
  _dhDlg = { collar: (trio && trio.collar) || null, survey: (trio && trio.survey) || null, intervals: trio && trio.intervals ? [trio.intervals] : [], method: 'minimumCurvature', dip: 'auto' };
  renderDhDialog();
  $('#dhDlg').classList.add('show');
}

export async function dhPickFile(defaultRole) {
  try {
    let file;
    if (window.showOpenFilePicker) { const [h] = await window.showOpenFilePicker(); file = await h.getFile(); _fileHandles.set(file, h); }
    else { file = await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.onchange = () => res(i.files[0]); i.click(); }); }
    if (!file) return null;
    const sniff = sniffDelimitedSafe(await file.slice(0, 64 * 1024).text());
    const columns = sniff && sniff.header ? sniff.header.map((c) => String(c).trim()) : [];
    const cls = classifyDrillholeHeader(columns);
    return { blob: file, name: file.name, columns, mapping: cls && cls.role === defaultRole ? { ...cls.mapping } : {} };
  } catch { return null; }
}

export async function dhPickSlot(role) { const s = await dhPickFile(role); if (s) { _dhDlg[role] = s; renderDhDialog(); } }

export async function dhPickInterval(idx) { const s = await dhPickFile('intervals'); if (s) { _dhDlg.intervals[idx] = s; renderDhDialog(); } }

export function sniffDelimitedSafe(text) { try { return sniffDelimited(text); } catch { return null; } }

export const DH_FIELDS = {
  collar: [['bhid', 'hole id'], ['x', 'X'], ['y', 'Y'], ['z', 'Z'], ['eoh', 'EOH (optional)']],
  survey: [['bhid', 'hole id'], ['at', 'depth (AT)'], ['az', 'azimuth'], ['dip', 'dip']],
  intervals: [['bhid', 'hole id'], ['from', 'FROM'], ['to', 'TO']],
};

export function renderDhDialog() {
  const body = $('#dhDlgBody');
  body.textContent = '';
  const mkSel = (opts, value, onchange, allowNone) => {
    const sel = document.createElement('select');
    if (allowNone) { const o = document.createElement('option'); o.value = '-1'; o.textContent = '—'; sel.appendChild(o); }
    opts.forEach((name, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = name; sel.appendChild(o); });
    sel.value = String(value != null && value >= 0 ? value : -1);
    if (sel.value === '' && opts.length) sel.value = '0';
    sel.onchange = onchange;
    return sel;
  };
  const slotRow = (labelText, slot, fieldRole, onPick, onRemove) => {
    const row = document.createElement('div'); row.className = 'dh-row';
    const head = document.createElement('div'); head.className = 'dh-head';
    const lab = document.createElement('b'); lab.textContent = labelText;
    const fname = document.createElement('span'); fname.className = 'dh-file';
    fname.textContent = slot ? slot.name : '— no file —';
    const pick = document.createElement('button'); pick.textContent = slot ? 'change…' : 'pick…';
    pick.onclick = onPick;
    head.append(lab, fname, pick);
    if (onRemove) { const rm = document.createElement('button'); rm.textContent = '×'; rm.title = 'remove this interval table'; rm.onclick = onRemove; head.appendChild(rm); }
    row.appendChild(head);
    if (slot && slot.columns.length) {
      const maps = document.createElement('div'); maps.className = 'dh-maps';
      for (const [key, label] of DH_FIELDS[fieldRole]) {
        if (slot.mapping[key] == null && key !== 'eoh') slot.mapping[key] = 0;   // what the select shows IS the mapping
        const wrap = document.createElement('label');
        wrap.append(label + ' ');
        wrap.appendChild(mkSel(slot.columns, slot.mapping[key], (e) => { slot.mapping[key] = +e.target.value; }, key === 'eoh'));
        maps.appendChild(wrap);
      }
      row.appendChild(maps);
    }
    body.appendChild(row);
  };
  slotRow('collar', _dhDlg.collar, 'collar', () => dhPickSlot('collar'));
  slotRow('survey', _dhDlg.survey, 'survey', () => dhPickSlot('survey'));
  const ivs = _dhDlg.intervals.length ? _dhDlg.intervals : [null];   // always show at least one interval slot
  ivs.forEach((slot, idx) => {
    slotRow(ivs.length > 1 ? `intervals ${idx + 1}` : 'intervals', slot, 'intervals',
      () => dhPickInterval(idx),
      idx > 0 ? () => { _dhDlg.intervals.splice(idx, 1); renderDhDialog(); } : null);
  });
  const addRow = document.createElement('div'); addRow.className = 'dh-row';
  const addBtn = document.createElement('button'); addBtn.textContent = '+ add interval table';
  addBtn.title = 'log more than one interval table (assay, geology, geotech…) against the same holes';
  addBtn.onclick = () => dhPickInterval(_dhDlg.intervals.length);
  addRow.appendChild(addBtn);
  body.appendChild(addRow);
  const cfg = document.createElement('div'); cfg.className = 'dh-maps';
  const mW = document.createElement('label'); mW.append('desurvey ');
  const mSel = document.createElement('select');
  for (const [v, t] of [['minimumCurvature', 'minimum curvature'], ['balancedTangential', 'balanced tangential'], ['tangential', 'tangential']]) {
    const o = document.createElement('option'); o.value = v; o.textContent = t; mSel.appendChild(o);
  }
  mSel.value = _dhDlg.method; mSel.onchange = () => { _dhDlg.method = mSel.value; };
  mW.appendChild(mSel);
  const dW = document.createElement('label'); dW.append('dip convention ');
  const dSel = document.createElement('select');
  for (const [v, t] of [['auto', 'auto-detect'], ['pos-down', 'positive down'], ['neg-down', 'negative down']]) {
    const o = document.createElement('option'); o.value = v; o.textContent = t; dSel.appendChild(o);
  }
  dSel.value = _dhDlg.dip; dSel.onchange = () => { _dhDlg.dip = dSel.value; };
  dW.appendChild(dSel);
  cfg.append(mW, dW);
  body.appendChild(cfg);
}

// the import dialog's Import button
export async function dhImport() {
  const d = _dhDlg;
  const intervals = (d && d.intervals || []).filter(Boolean);
  if (!d || !d.collar || !d.survey || !intervals.length) { $('#dhDlgMsg').textContent = 'need collar, survey, and at least one interval table'; return; }
  $('#dhDlg').classList.remove('show');
  const roleMap = (slot) => (slot.mapping && slot.mapping.bhid != null ? { ...slot.mapping } : null);
  const collarMap = roleMap(d.collar), surveyMap = roleMap(d.survey);
  // one dh layer per interval table, all sharing collar + survey (a set)
  const key = nextDhSetKey();
  const ids = [];
  let first = !S.layers.length;
  for (const iv of intervals) {
    const mappings = {};
    if (collarMap) mappings.collar = collarMap;
    if (surveyMap) mappings.survey = surveyMap;
    const ivm = roleMap(iv); if (ivm) mappings.intervals = ivm;
    const _got = await openDrillholeLayer({ collar: d.collar.blob, survey: d.survey.blob, intervals: iv.blob }, { mappings, method: d.method, dipConvention: d.dip }, first ? 'replace' : 'add');
    const L = layerById(_got); if (L) { L._setKey = key; L._intervalName = iv.name; ids.push(L.id); }
    first = false;
  }
  if (ids.length) createLayerGroup(dhGroupName(basename(d.collar.name)), ids, { collapsed: false, dhSet: true });
}

export function dhCancel() { $('#dhDlg').classList.remove('show'); }
