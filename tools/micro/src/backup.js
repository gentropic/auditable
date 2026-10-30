// micro project backups — the whole project folder as ONE file, `<name>.zip.micro`.
//
// The file is a plain ZIP (rename it .zip and any tool opens it):
//   mimetype            stored, first, bare — application/vnd.gentropic.micro-project
//                       (the EPUB / ODF / .wfr convention: the type is readable at a fixed offset)
//   micro-backup.json   what it is: project name, when, which build, full or lean, the file list
//   project/…           the folder, every file at its relative path
//
// Streamed both ways through @gcu/archive's zipstream (Zip64, stored, CRC-checked on
// restore), so a project with multi-GB models never sits in memory. "Lean" skips only
// what micro rebuilds by itself — the discovery/stats cache (*.meta.json) and the
// GeoTIFF display cache (*.disp.grd / *.disp.json); everything else in the folder is
// data, including hand-dropped files the folder-as-inbox scan would pick up and the
// .cols/ sidecars (painted and materialized columns).
import { createZipStreamWriter, openZipRanged, blobSource } from '../../../ext/archive/src/zipstream.js';

export const BACKUP_MIME = 'application/vnd.gentropic.micro-project';
export const BACKUP_EXT = '.zip.micro';
export const isBackupName = (name) => /\.micro$/i.test(String(name || ''));
const LEAN_SKIP = /(\.meta\.json|\.disp\.grd|\.disp\.json)$/i;
const ROOT = 'project/';

// every file under dir, depth-first, sorted by path (stable archives); lean splits off the caches
export async function inventoryProject(dir, { lean = false } = {}) {
  const files = [], skipped = [];
  const walk = async (d, prefix) => {
    const kids = [];
    for await (const [name, h] of d.entries()) kids.push([name, h]);
    kids.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [name, h] of kids) {
      const path = prefix + name;
      if (h.kind === 'directory') { await walk(h, path + '/'); continue; }
      const f = await h.getFile();
      const rec = { path, size: f.size, lastModified: f.lastModified, handle: h };
      (lean && LEAN_SKIP.test(name) ? skipped : files).push(rec);
    }
  };
  await walk(dir, '');
  const sum = (a) => a.reduce((t, r) => t + r.size, 0);
  return { files, skipped, bytes: sum(files), skippedBytes: sum(skipped) };
}

// sink: { write(u8) } or a WritableStream. onProgress({ path, done, total, index, count })
export async function writeBackup(dir, sink, { lean = false, name, build, linked = [], onProgress, signal } = {}) {
  const inv = await inventoryProject(dir, { lean });
  if (!inv.files.some((r) => r.path === 'project.json')) throw new Error('this folder has no project.json — save the project first');
  const w = createZipStreamWriter(sink);
  await w.add('mimetype', BACKUP_MIME, { aligned: false });
  const info = {
    format: 1, app: 'micro', project: name || dir.name, created: new Date().toISOString(), build: build || null,
    lean: !!lean, root: ROOT,
    files: inv.files.map((r) => ({ path: r.path, size: r.size })),
    skipped: inv.skipped.map((r) => r.path),
    linked,                                                // layers that live OUTSIDE the folder — not in this backup
  };
  await w.add('micro-backup.json', JSON.stringify(info, null, 1), { aligned: false, mtime: Date.now() });
  let done = 0;
  for (let i = 0; i < inv.files.length; i++) {
    if (signal && signal.aborted) throw new DOMException('backup cancelled', 'AbortError');
    const r = inv.files[i];
    const f = await r.handle.getFile();
    if (f.size !== r.size) throw new Error(`${r.path} changed while the backup was being written — try again`);
    const m = w.begin(ROOT + r.path, { aligned: false, mtime: r.lastModified });
    const rd = f.stream().getReader();
    for (;;) {
      const { done: end, value } = await rd.read(); if (end) break;
      await m.write(value); done += value.length;
      if (onProgress) onProgress({ path: r.path, done, total: inv.bytes, index: i, count: inv.files.length });
      if (signal && signal.aborted) { rd.cancel().catch(() => {}); throw new DOMException('backup cancelled', 'AbortError'); }
    }
    await m.end();
  }
  const res = await w.finish();
  return { size: res.size, files: inv.files.length, bytes: inv.bytes, skipped: inv.skipped.length, skippedBytes: inv.skippedBytes };
}

// → { zip, info }; refuses anything that isn't a micro backup
export async function readBackup(blob) {
  let zip;
  try { zip = await openZipRanged(blobSource(blob)); } catch (e) { throw new Error(`not a micro backup (${e.message})`); }
  const mt = zip.entries.get('mimetype');
  if (!mt || new TextDecoder().decode(await zip.bytes(mt)).trim() !== BACKUP_MIME) throw new Error('not a micro backup (no micro mimetype inside)');
  const ie = zip.entries.get('micro-backup.json');
  const info = ie ? JSON.parse(new TextDecoder().decode(await zip.bytes(ie))) : {};
  if (info.format != null && info.format > 1) throw new Error(`this backup was made by a newer micro (format ${info.format})`);
  const members = zip.list().filter((e) => e.name.startsWith(ROOT) && !e.dir && e.name.length > ROOT.length);
  if (!members.some((e) => e.name === ROOT + 'project.json')) throw new Error('this backup has no project.json inside — damaged or not a project');
  for (const e of members) {
    const rel = e.name.slice(ROOT.length);
    if (rel.split('/').some((s) => s === '' || s === '.' || s === '..') || rel.includes('\\')) throw new Error(`refusing an unsafe path in the backup: ${e.name}`);
  }
  const bytes = members.reduce((t, e) => t + e.size, 0);
  return { zip, info, members, bytes };
}

// unpack into dest: refuses a folder that already holds a project, or any file the
// backup would overwrite; every member is CRC-checked as it streams
export async function restoreBackup(blob, dest, { onProgress, signal } = {}) {
  const { info, members, bytes, zip } = await readBackup(blob);
  try { await dest.getFileHandle('project.json'); throw new Error('that folder already holds a micro project — pick an empty one'); }
  catch (e) { if (e.name !== 'NotFoundError' && e.name !== 'TypeError') throw e; }
  const dirOf = async (parts, create) => {
    let d = dest;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  };
  for (const e of members) {                                // collisions first: nothing written if one exists
    const parts = e.name.slice(ROOT.length).split('/'), fname = parts.pop();
    try { const d = await dirOf(parts, false); await d.getFileHandle(fname); throw new Error(`that folder already has ${parts.concat(fname).join('/')} — pick an empty one`); }
    catch (err) { if (err.name !== 'NotFoundError' && err.name !== 'TypeError') throw err; }
  }
  let done = 0;
  for (let i = 0; i < members.length; i++) {
    const e = members[i];
    if (signal && signal.aborted) throw new DOMException('restore cancelled', 'AbortError');
    const parts = e.name.slice(ROOT.length).split('/'), fname = parts.pop();
    const fh = await (await dirOf(parts, true)).getFileHandle(fname, { create: true });
    const ws = await fh.createWritable();
    try {
      const rd = zip.stream(e).getReader();
      for (;;) {
        const { done: end, value } = await rd.read(); if (end) break;
        await ws.write(value); done += value.length;
        if (onProgress) onProgress({ path: parts.concat(fname).join('/'), done, total: bytes, index: i, count: members.length });
      }
      await ws.close();
    } catch (err) { try { await ws.abort(); } catch { /* already closed */ } throw err; }
  }
  return { info, files: members.length, bytes };
}
