// micro — the doors to the host: a file out (deliverBlob), the folder picker, and a
// stored folder handle brought back to life. On the web these are a download link
// and the File System Access API; inside the lead-acid shell, its publish stream
// and its tree plugin. Whether folders can be picked at all is S.hasFSAA (state.js),
// which the app sets at boot.
import { shell } from '../../../ext/leadacid/index.js';
import { fmtSize } from './paths.js';
const $ = (s) => document.querySelector(s);

// the folder picker, one door: resolves to a directory handle, rejects when the user backs out (both hosts)
export async function pickDirectory() {
  if (!shell.present) return window.showDirectoryPicker({ mode: 'readwrite' });
  const d = await shell.tree.pick({ initial: 'primary:Download' });   // opens in Downloads — where phone data lives; the user navigates anywhere
  if (!d) throw new DOMException('The user aborted a request.', 'AbortError');
  return d;
}

// a handle out of IndexedDB: a web handle passes through; a shell tree handle's
// structured clone comes back to life (re-validating the folder grant)
export const rehydrateHandle = (h) => (shell.present && shell.tree.isTreeHandle(h)) ? shell.tree.rehydrate(h) : Promise.resolve(h);

// ONE door for every export. On the web: an <a download>. Inside the lead-acid
// shell a blob: download goes nowhere (no DownloadListener, by design), so the
// blob is STREAMED into Downloads (a pending MediaStore row, visible on close —
// a multi-GB parquet never sits in page memory) and the status bar offers the
// share sheet, by reference to the published file. Fire-and-forget: callers set
// their own status first; the shell outcome is appended when it lands.
export async function deliverBlob(blob, filename) {
  // an empty export is always a failure upstream (a CSV of no rows still has its header; a figure
  // whose capture timed out came out as 0 bytes once, under load) — say so, never save an empty file
  if (!blob || !blob.size) {
    $('#meta').textContent = `${filename}: the export came out empty (0 bytes) — nothing was saved; try again`;
    return false;
  }
  if (!shell.present) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    return;
  }
  const mime = blob.type || 'application/octet-stream';
  const meta = $('#meta');
  try {
    const w = shell.publishStream(filename, { collection: 'Downloads', mime });
    await blob.stream().pipeTo(w);
    const r = await w.result;
    const name = r.name || filename;
    const prev = meta.textContent && !/ → Downloads/.test(meta.textContent) ? meta.textContent + ' · ' : '';
    meta.textContent = `${prev}saved ${name} → Downloads (${fmtSize(r.bytes)}) `;
    const b = document.createElement('button'); b.className = 'meta-act'; b.textContent = 'share…'; b.title = 'hand the file to another app';
    b.onclick = () => { shell.share(name, null, { mime, uri: r.uri }); };
    meta.appendChild(b);
  } catch (e) { meta.textContent = `could not save ${filename}: ${e.message || e}`; }
}
