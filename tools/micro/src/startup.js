// micro startup — the first part of the app to run (src/boot.js has the order): the theme and
// the interface language before anything draws, the build stamp, the empty state (recent files,
// recent projects, the project-folder capability), and the window-level wiring that belongs to
// no tool — unsaved-work guard, Ctrl+S, the project-dirty event, drag and drop. Carved from
// index.html's inline script (2026-11-24).
import { shell } from '../../../ext/leadacid/index.js';
import { S } from './state.js';
import { initLang, offerLanguage } from './i18n.js';
import { unsavedWork, markProjectDirty, saveProject } from './project.js';
import { openFilesDialog } from './open-dialog.js';
import { initTheme } from './theme.js';
import { refreshRecents, renderEmptyProjects, addRecent } from './recents.js';

initTheme();
initLang();                                                 // the interface language (static chrome now; menus, windows, palette as they draw)
offerLanguage(document.querySelector('#empty'));                               // a browser in Portuguese: a one-line offer, never a switch
const __MICRO_BUILD__ = 'dev';                             // stamped '<version> · <hash> · <date>' by node build.js --target=micro
S.build = __MICRO_BUILD__;

// ── recents (local · opt-in · clearable) — lamina's pattern verbatim ──
// LOCAL only: IndexedDB, never transmitted (connect-src 'none' holds). An FSAA
// handle persists (reopening re-grants permission via the browser — no silent
// re-read); without one (drag / <input> fallback) we keep the name and re-pick.
// Transparent (shown on the empty state), clearable, disableable (File menu).
// (_idb — the IndexedDB kv — lives in src/element-store.js; _fileHandles — the
// File → FileSystemFileHandle map — lives in src/state.js)

refreshRecents();

// ── project folders (micro-layers spec §12, G1 — Chromium/FSAA-gated) ──
// The folder IS the project: project.json (layers + display state + camera +
// section + saved views) + the source files beside it. "Save as" copies any
// in-memory sources INTO the folder (we hold the blobs), so a saved project is
// self-contained. Handles persist in IDB (re-grant on reopen, never silent).
// Write-on-save-only: Ctrl+S, dirty marker, no background writes.
// Project folders: the File System Access API on the web; inside the lead-acid
// shell the TREE plugin (Android's folder picker, grant persisted per folder).
// The WebView DEFINES showDirectoryPicker but aborts it instantly — so when the
// shell is present ITS answer decides, and the API's presence is ignored.
S.hasFSAA = shell.present ? false : !!window.showDirectoryPicker;
if (shell.present) shell.tree.probe().then((ok) => { S.hasFSAA = ok; renderEmptyProjects(); }).catch(() => {});

addEventListener('beforeunload', (e) => { if (unsavedWork()) { e.preventDefault(); e.returnValue = ''; } });

// recent projects on the empty state (src/project.js)
renderEmptyProjects();
// dirty triggers: anything that lands in the manifest (camera excluded — it's
// captured at save time; orbiting shouldn't nag)
addEventListener('micro:project-dirty', markProjectDirty);
// Ctrl+S saves the project (or prompts Save as… when none)
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.hasFSAA) { e.preventDefault(); saveProject(); }
});
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag'); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag'); });
addEventListener('drop', (e) => {
  e.preventDefault(); document.body.classList.remove('drag');
  const files = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
  if (!files.length) return;
  for (const f of files) addRecent(f, null);
  openFilesDialog(files);
});
