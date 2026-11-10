// micro — recent files: the remembered handles, the empty-state list, and the file picker.
import { _idb } from './element-store.js';
import { closeMenu } from './menu.js';
import { S, _fileHandles } from './state.js';
import { openFilesDialog } from './open-dialog.js';
import { openBlob } from './open.js';
const $ = (s) => document.querySelector(s);

export const RECENTS_KEY = '__recents__', RECENTS_MAX = 12;

export let _recents = [];

export let _remember = (() => { try { return localStorage.getItem('micro.recents') !== 'off'; } catch { return true; } })();

export async function refreshRecents() { try { _recents = (_remember && (await _idb.get(RECENTS_KEY))) || []; } catch { _recents = []; } renderEmptyRecents(); }

export async function addRecent(file, handle) {
  if (!_remember || !file) return;
  try {
    const key = file.name + ':' + file.size;
    const list = (await _idb.get(RECENTS_KEY)) || [];
    _recents = [{ name: file.name, size: file.size, mtime: file.lastModified || 0, handle: handle || null }]
      .concat(list.filter((e) => e.name + ':' + e.size !== key)).slice(0, RECENTS_MAX);
    await _idb.set(RECENTS_KEY, _recents);
    renderEmptyRecents();
  } catch { /* best-effort */ }
}

export async function clearRecents() { try { await _idb.set(RECENTS_KEY, []); } catch { /* ignore */ } _recents = []; renderEmptyRecents(); }

export function setRemember(on) { _remember = on; try { localStorage.setItem('micro.recents', on ? 'on' : 'off'); } catch { /* ignore */ } if (on) refreshRecents(); else clearRecents(); }

// Reopen a recent: with a handle → re-grant permission + getFile; without →
// re-pick (we can't, and won't, silently re-read).
export async function openRecent(entry) {
  closeMenu();
  if (entry && entry.handle && entry.handle.getFile) {
    try {
      const h = entry.handle;
      if (h.queryPermission) {
        let perm = await h.queryPermission({ mode: 'read' });
        if (perm !== 'granted' && h.requestPermission) perm = await h.requestPermission({ mode: 'read' });
        if (perm !== 'granted') { $('#meta').textContent = 'permission denied — open it again'; return; }
      }
      const f = await h.getFile();
      addRecent(f, h);
      _fileHandles.set(f, h);
      // a recent is the picker with the file pre-picked: same dialog, same
      // add/replace radio. An empty view opens straight — nothing to replace.
      if (S.layers.length) return openFilesDialog([f]);
      return openBlob(f, f.name, 'replace');
    } catch { $('#meta').textContent = `couldn't reopen “${entry.name}” — pick it again`; return openFilePicker(); }
  }
  $('#meta').textContent = `“${entry.name}” has no saved handle — pick it again`;
  return openFilePicker();
}

// Recents on the empty state (the prime reopen moment). Chips need
// pointer-events (the banner is otherwise click-through for drops).
export function renderEmptyRecents() {
  const el = $('#emptyRecents'); if (!el) return;
  el.textContent = '';
  if (!_remember || !_recents.length) return;
  const lab = document.createElement('span'); lab.className = 'er-label'; lab.textContent = 'recent:';
  el.appendChild(lab);
  for (const e of _recents.slice(0, 8)) {
    const chip = document.createElement('a'); chip.className = 'er-chip' + (e.handle ? '' : ' nohandle');
    chip.textContent = e.name; chip.title = e.handle ? 'reopen' : 'no saved handle — re-pick';
    chip.onclick = () => openRecent(e);
    el.appendChild(chip);
  }
}

export function openFilePicker() {
  if (window.showOpenFilePicker) {
    (async () => {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        const files = [];
        for (const h of handles) { const f = await h.getFile(); addRecent(f, h); _fileHandles.set(f, h); files.push(f); }
        if (files.length) openFilesDialog(files);
      } catch { /* cancelled */ }
    })();
  } else {
    // The <input> fallback (Firefox + mobile). NO `accept` filter: on Android the
    // OS picker hides files whose extension has no registered MIME — which greys
    // out a .dm (lamina's lesson).
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.onchange = () => {
      const files = [...inp.files];
      if (!files.length) return;
      for (const f of files) addRecent(f, null);
      openFilesDialog(files);
    };
    inp.click();
  }
}
