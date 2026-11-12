// micro — a project as ONE FILE: back up a project folder to a .zip.micro pack, open a
// pack in place (read-only, or saved out as a folder), and restore a pack into a new
// folder. The pack format itself is src/backup.js; the folder save and open are
// src/project.js.
import { _fileHandles, S } from './state.js';
import { microChoose, microConfirm } from './prompts.js';
import { saveProject, openProjectDir, updateProjectTitle, _copiedBlobs } from './project.js';
import { inventoryProject, BACKUP_EXT, BACKUP_MIME, writeBackup, readBackup, openPack, writeTree, restoreBackup } from './backup.js';
import { fmtSize, layerFiles, resolveFileHandle } from './paths.js';
import { shell } from '../../../ext/leadacid/index.js';
import { deliverBlob, pickDirectory } from './hostio.js';
import { rememberPack, rememberProject } from './recents.js';
const $ = (s) => document.querySelector(s);

export async function openPackFromHandle(h) {
  try {
    if (h.queryPermission && await h.queryPermission({ mode: 'read' }) !== 'granted' && h.requestPermission) await h.requestPermission({ mode: 'read' });
    const f = await h.getFile();
    _fileHandles.set(f, h);
    return await openProjectPack(f);
  } catch (e) { $('#meta').textContent = `open pack: ${h.name} can't be read any more (moved or deleted?) — ${e.message || e}`; return null; }
}
// Tidy: migrate an already-saved project's files into their kind subfolders
// (drillholes / models / clouds / meshes / grids), carrying sidecars along and
// rewriting project.json + the drillhole descriptors. Files are MOVED (not
// copied), confirmed first; external/linked layers stay put.
// ── project backups: the folder as one `<name>-<date>.zip.micro` (src/backup.js) ──
// Made from the FOLDER, so it holds the last save; linked layers (outside the
// folder) aren't in it and are named. Streamed to a picked file (the web), to
// Downloads (the shell) or, for a host, to a stream it hands in — never resident.
// Host calls pass { lean, to, save } and get no dialogs.
const backupStamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
function progressMeta(verb) {
  let t = 0;
  return (p) => {
    const now = performance.now(); if (now - t < 200 && p.done < p.total) return; t = now;
    $('#meta').textContent = `${verb}… ${p.total ? Math.round(100 * p.done / p.total) : 100}% · ${p.index + 1}/${p.count} · ${p.path}`;
  };
}
export async function backupProject({ lean = null, to = null, save = null, host = false } = {}) {
  if (!S.project) { if (host) throw new Error('micro: no project is open'); $('#meta').textContent = 'back up: open or save a project first'; return null; }
  if (S.project.dirty) {
    let a = save == null ? null : (save ? 'save' : 'as-is');
    if (a == null && !host) a = await microChoose('back up project', `${S.project.name} has unsaved changes. A backup is made from the project folder, so on its own it holds the last save.`,
      [{ label: 'Cancel', value: null }, { label: 'Back up the last save', value: 'as-is' }, { label: 'Save, then back up', value: 'save' }]);
    if (a == null && !host) return null;
    if (a === 'save') await saveProject();
  }
  const dir = S.project.dir;
  const linked = S.layers.filter((L) => L.storage === 'external').map((L) => L.label || L.name);
  if (lean == null && !host) {
    const inv = await inventoryProject(dir, { lean: true });   // both sizes from one walk
    const n = inv.files.length + inv.skipped.length, full = inv.bytes + inv.skippedBytes;
    const msg = `${S.project.name}: ${n} file${n === 1 ? '' : 's'}, ${fmtSize(full)}.`
      + (inv.skipped.length ? ` Lean leaves out ${inv.skipped.length} cache file${inv.skipped.length === 1 ? '' : 's'} micro rebuilds by itself (${fmtSize(inv.skippedBytes)}); a big model is then re-read once when the project opens.` : '')
      + (linked.length ? ` Not in the backup: ${linked.length} layer${linked.length === 1 ? '' : 's'} linked from outside the folder (${linked.slice(0, 3).join(', ')}${linked.length > 3 ? ', …' : ''}) — to include ${linked.length === 1 ? 'it' : 'them'}, save the project and choose “Copy into project”.` : '');
    const a = await microChoose('back up project', msg, [{ label: 'Cancel', value: null },
      ...(inv.skipped.length ? [{ label: `Lean (${fmtSize(inv.bytes)})`, value: 'lean' }] : []), { label: `Full (${fmtSize(full)})`, value: 'full' }]);
    if (!a) return null;
    lean = a === 'lean';
  }
  const fname = `${S.project.name.replace(/[\/:*?"<>|]+/g, '_')}-${backupStamp()}${BACKUP_EXT}`;
  // the sink: ours to close or abort, whatever is behind it
  let ws = null, parts = null, handle = null;
  try {
    if (to && typeof to.createWritable === 'function') ws = await to.createWritable();
    else if (to && typeof to.getWriter === 'function') ws = to;
    else if (to) throw new Error('micro: backupProject `to` must be a WritableStream or a FileSystemFileHandle');
    else if (host) parts = [];
    else if (shell.present) ws = shell.publishStream(fname, { collection: 'Downloads', mime: BACKUP_MIME });
    else if (window.showSaveFilePicker) {
      handle = await window.showSaveFilePicker({ suggestedName: fname, types: [{ description: 'micro project backup', accept: { [BACKUP_MIME]: ['.micro'] } }] });
      ws = await handle.createWritable();
    } else parts = [];
  } catch (e) { if (e && e.name === 'AbortError') return null; if (host) throw e; $('#meta').textContent = `back up: can't write there — ${e.message || e}`; return null; }
  const wr = ws ? ws.getWriter() : null;
  const sink = wr ? { write: (b) => wr.write(b) } : { write: (b) => { parts.push(b.slice()); } };
  let res;
  try {
    res = await writeBackup(dir, sink, { lean: !!lean, name: S.project.name, build: S.build, linked, onProgress: progressMeta('backing up') });
    if (wr) await wr.close();
  } catch (e) {
    if (wr) { try { await wr.abort(); } catch { /* gone */ } }
    if (host) throw e;
    $('#meta').textContent = `back up failed: ${e.message || e}`; return null;
  }
  const out = { name: handle ? handle.name : fname, size: res.size, files: res.files, lean: !!lean, linked };
  if (ws && ws.result) { try { const r = await ws.result; out.name = r.name || out.name; } catch { /* the shell reports its own */ } }
  if (parts) out.blob = new Blob(parts, { type: BACKUP_MIME });
  if (!host) {
    $('#meta').textContent = `backed up ${S.project.name} → ${out.name} (${fmtSize(res.size)}, ${res.files} files${lean ? ', lean' : ''})${linked.length ? ` · ${linked.length} linked layer${linked.length === 1 ? '' : 's'} not included` : ''}`;
    if (parts) await deliverBlob(out.blob, fname);
  }
  return out;
}
// ── project packs: a .zip.micro opened as the project, read-only, nothing unpacked ──
// Each file is a slice of the pack (src/backup.js openPack). Changes in the session
// — bookmarks, recipes, painted columns — live in memory beside it; Save writes the
// whole project, changes included, into an empty folder and carries on there. A
// slice skips the CRC, so the pack is read through once in the background and the
// verdict goes to the status line (and to a host as micro:pack-checked).
const pickBackupFile = async () => {
  try {
    if (window.showOpenFilePicker) { const [h] = await window.showOpenFilePicker({ types: [{ description: 'micro project pack', accept: { [BACKUP_MIME]: ['.micro'] } }] }); const f = await h.getFile(); _fileHandles.set(f, h); return f; }
    return await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.micro'; i.onchange = () => res(i.files[0] || null); i.click(); });
  } catch { return null; }
};
function packSummary(blob, info, members, bytes) {
  const when = info.created ? new Date(info.created).toLocaleString() : 'unknown date';
  const lk = info.linked || [];
  return `${blob.name || 'backup'}: “${info.project || '?'}”, backed up ${when}${info.lean ? ' (lean)' : ''} — ${members.length} files, ${fmtSize(bytes)}.`
    + (lk.length ? ` It doesn't hold ${lk.length} layer${lk.length === 1 ? '' : 's'} that were linked from outside the folder (${lk.slice(0, 3).join(', ')}${lk.length > 3 ? ', …' : ''}); the project will ask where they are.` : '')
    + (S.project && S.project.dirty ? ` This closes ${S.project.name}, which has unsaved changes.` : '');
}
// a .zip.micro opened like any file (drop, Open…, "open with"): look, or unpack
export async function openPackFile(blob) {
  let rb;
  try { rb = await readBackup(blob); } catch (e) { $('#meta').textContent = `open: ${e.message}`; return null; }
  const a = await microChoose('project pack', packSummary(blob, rb.info || {}, rb.members, rb.bytes)
    + ' Open it read-only to look around (nothing is unpacked), or unpack it into an empty folder to work in it.',
    [{ label: 'Cancel', value: null }, ...(S.hasFSAA ? [{ label: 'Unpack to a folder…', value: 'unpack' }] : []), { label: 'Open (read-only)', value: 'open' }]);
  if (a === 'unpack') return restoreProject(blob, null, { asked: true });
  if (a === 'open') return openProjectPack(blob, { asked: true });
  return null;
}
export async function openProjectPack(blob = null, { host = false, asked = false } = {}) {
  const fail = (m) => { if (host) throw new Error(`micro: ${m}`); $('#meta').textContent = `open pack: ${m}`; return null; };
  if (!blob) { blob = await pickBackupFile(); if (!blob) return null; }
  let pack;
  try { pack = await openPack(blob); } catch (e) { return fail(e.message); }
  if (!host && !asked && S.project && S.project.dirty
    && !(await microConfirm('open project pack', `This closes ${S.project.name}, which has unsaved changes.`, 'Open pack', 'Cancel'))) return null;
  if (S.project && S.project.pack && S.project.pack.abort) S.project.pack.abort.abort();
  if (!(await openProjectDir(pack.dir, { pack }))) return fail($('#meta').textContent.replace(/^project open failed — /, '') || 'the project in the pack did not open');
  updateProjectTitle();
  { const h = !host && _fileHandles.get(blob); if (h) rememberPack(h, pack.dir.name); }
  pack.abort = new AbortController();
  pack.check = pack.verify({ signal: pack.abort.signal }).then((v) => {
    pack.checked = v;
    dispatchEvent(new CustomEvent('micro:pack-checked', { detail: { name: blob.name || pack.dir.name, ok: v.ok, files: v.files, bad: v.bad } }));
    if (!S.project || S.project.pack !== pack) return v;
    if (v.ok) $('#meta').textContent = `pack checked — ${v.files} files intact`;
    else {
      $('#meta').textContent = `pack DAMAGED — ${v.bad.length} file${v.bad.length === 1 ? '' : 's'} fail their checksum: ${v.bad.map((b) => b.path).slice(0, 3).join(', ')}${v.bad.length > 3 ? ', …' : ''}`;
      if (!host) microChoose('project pack damaged', `${v.bad.length} of the ${v.files} files in ${blob.name || 'the pack'} don't match the checksum they were written with, so what micro shows from them may be wrong: ${v.bad.map((b) => b.path).join(', ')}.`, [{ label: 'OK', value: true }]);
    }
    return v;
  }, (e) => { if (e && e.name !== 'AbortError') $('#meta').textContent = `pack check failed — ${e.message || e}`; return null; });
  return { name: pack.dir.name, files: pack.members.length, bytes: pack.bytes, info: pack.info, checked: pack.check };
}
// Save on a pack: the whole tree (the pack's files + this session's changes) into
// an empty folder, which then becomes the project; a normal save writes the rest
export async function savePackAsFolder({ dest = null, host = false } = {}) {
  const pack = S.project.pack;
  if (!dest && !S.hasFSAA) { $('#meta').textContent = "save: a project pack is read-only here — this browser can't write project folders"; return null; }
  if (!host && !dest) {
    const ok = await microChoose('save project', `${S.project.name} is a project pack, opened read-only. To keep your changes, save it as a project folder: pick an empty folder and micro writes the whole project there (${fmtSize(pack.bytes)}), then carries on working in it. The pack itself stays as it is.`,
      [{ label: 'Cancel', value: false }, { label: 'Choose folder…', value: true }]);
    if (!ok) return null;
  }
  if (!dest) { try { dest = await pickDirectory(); } catch { return null; } }
  const src = S.project.dir;
  try { await writeTree(src, dest, { onProgress: progressMeta('saving the pack as a folder') }); }
  catch (e) { if (host) throw e; $('#meta').textContent = `save failed — ${e.message || e}`; return null; }
  // the layers' files are now in dest: point them there, and say they're micro's copies
  for (const L of S.layers) {
    for (const fd of layerFiles(L)) _copiedBlobs.add(fd.blob);
    if (L.handle && L.handle._pack && L.handle._path) { try { L.handle = await resolveFileHandle(dest, L.handle._path.join('/')); } catch { /* triage finds it by path */ } }
  }
  if (pack.abort) pack.abort.abort();
  S.project = { dir: dest, name: dest.name, dirty: true };
  updateProjectTitle();
  await saveProject();
  rememberProject(dest);
  return { name: dest.name };
}
// restore: a .zip.micro → an EMPTY folder → opened as the project
export async function restoreProject(blob = null, dest = null, { host = false, asked = false } = {}) {
  const fail = (m) => { if (host) throw new Error(`micro: ${m}`); $('#meta').textContent = `restore: ${m}`; return null; };
  if (!dest && !S.hasFSAA) return fail("this browser can't write project folders");
  if (!blob) { blob = await pickBackupFile(); if (!blob) return null; }
  let rb;
  try { rb = await readBackup(blob); } catch (e) { return fail(e.message); }
  if (!host && !asked) {
    if (!(await microChoose('restore project', packSummary(blob, rb.info || {}, rb.members, rb.bytes) + ' Next, pick an empty folder to restore it into.',
      [{ label: 'Cancel', value: false }, { label: 'Choose folder…', value: true }]))) return null;
  }
  if (!dest) { try { dest = await pickDirectory(); } catch { return null; } }
  let res;
  try { res = await restoreBackup(blob, dest, { onProgress: progressMeta('restoring') }); } catch (e) { return fail(e.message || String(e)); }
  await openProjectDir(dest);
  if (S.hasFSAA) rememberProject(dest);
  if (!host) $('#meta').textContent = `restored ${(rb.info && rb.info.project) || 'the project'} into ${dest.name} (${res.files} files, ${fmtSize(res.bytes)})`;
  return { name: dest.name, files: res.files, bytes: res.bytes, info: rb.info };
}
