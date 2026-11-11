// micro — Tools → Settings: the remembered preferences, in one window.
import { _bgColor, setBg } from './deco.js';
import { _autoApply } from './props.js';
import { _windingGpu, setWindingGpu } from './bygeom.js';
import { setPinBudget } from './columns.js';
import { _autoOptimize, _autoPack, setAutoOptimize, setAutoPack } from './project.js';
import { floatWin, raiseWindow } from './windows.js';
import { requestRender } from './state.js';
import { _nlOn, nlEnsureTrained, nlSetEnabled } from './nl.js';
import { _selStick, setSelStick } from './selection.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setSettingsHooks): _blockEdges, _secFollow, setBlockEdges
let H = {};
export function setSettingsHooks(h) { H = h; }

// Tools = the instruments and readouts (lamina's grammar: View is how it
// LOOKS, Tools is what you DO to it)
// ── Settings — machine preferences, one declarative registry ────────────────
// Three kinds of state: VIEW state travels with the project (bookmarks, pinned
// windows), DATA decisions live in the manifests (mappings, desurvey) — and
// MACHINE preferences (how this user on this machine likes micro to behave)
// live here, in localStorage micro.*, never in the project. The window renders
// itself from PREFS; adding a preference = adding a row.
export const PREFS = [
  { sec: 'display', label: 'background', desc: 'the scene clear colour — white or paper for print-bound figures (decorations flip to dark ink)', kind: 'choice', opts: [['#121212', 'basalt'], ['#000000', 'black'], ['#ffffff', 'white'], ['#f4f2ec', 'paper']], get: () => _bgColor, set: (v) => setBg(v) },
  { sec: 'display', label: 'block edges', desc: 'outline every block face — and every cut block on a section', kind: 'toggle', get: () => H._blockEdges, set: (v) => H.setBlockEdges(v) },
  { sec: 'display', label: 'render budget', desc: 'elements per frame — lower is snappier while orbiting; the picture converges when the camera rests', kind: 'choice', opts: () => [...$('#budget').options].map((o) => [o.value, o.textContent]), get: () => $('#budget').value, set: (v) => { $('#budget').value = v; $('#budget').dispatchEvent(new Event('change')); requestRender(); } },
  { sec: 'interaction', label: 'selection tool stays armed', desc: 'after a rectangle / lasso: put the tool down, keep it while adding (shift/alt held on release), or keep it until Esc — middle-drag orbits either way', kind: 'choice', opts: [['oneshot', 'never (one shot)'], ['smart', 'with shift/alt held'], ['sticky', 'until Esc']], get: () => _selStick, set: (v) => setSelStick(v) },
  { sec: 'interaction', label: 'properties auto-apply', desc: 'style edits land as you make them; off = an explicit apply button', kind: 'toggle', get: () => _autoApply, set: (v) => { $('#ppAuto').checked = v; $('#ppAuto').dispatchEvent(new Event('change')); } },
  { sec: 'interaction', label: 'camera follows the section scrub', desc: 'scrubbing a section slab carries the camera along with it', kind: 'toggle', get: () => H._secFollow, set: (v) => { $('#secFollow').checked = v; $('#secFollow').dispatchEvent(new Event('input')); } },
  { sec: 'compute', label: 'by-solid compute', desc: 'the flag / select-by-solid engine — CPU is slower but cannot trip the GPU driver watchdog on a huge solid', kind: 'choice', opts: [['gpu', 'GPU (fast)'], ['cpu', 'CPU (watchdog-safe)']], get: () => (_windingGpu ? 'gpu' : 'cpu'), set: (v) => setWindingGpu(v === 'gpu') },
  { sec: 'compute', label: 'derived-column residency', desc: 'how much memory derived columns may keep resident before being re-derived on demand', kind: 'choice', opts: [['auto', 'auto (scales with RAM)'], ['off', 'off (re-derive on demand)'], ['256', '256 MB'], ['512', '512 MB'], ['1024', '1 GB']], get: () => { try { return localStorage.getItem('micro.pinBudget') || 'auto'; } catch { return 'auto'; } }, set: (v) => setPinBudget(v) },
  { sec: 'data', label: 'store meshes as .wfr on save', desc: 'pack mesh, strings and points layers into meshes/*.wfr when the project saves — bricked, compact, quick to reopen, attributes kept; source files are kept', kind: 'choice', opts: [['on', 'always'], ['off', 'never'], ['ask', 'ask on next save']], get: () => (_autoPack || 'ask'), set: (v) => setAutoPack(v === 'ask' ? null : v) },
  { sec: 'data', label: 'optimize models to spatial Parquet on save', desc: 'Morton-sort block models into spatial Parquet when the project saves — smaller, faster to reopen, row-group query skipping', kind: 'choice', opts: [['on', 'always'], ['off', 'never'], ['ask', 'ask on next save']], get: () => (_autoOptimize || 'ask'), set: (v) => setAutoOptimize(v === 'ask' ? null : v) },
  { sec: 'experimental', label: 'natural-language command bar', desc: '⌘K, type a phrase — it PROPOSES a command and never runs it; trains on this project\'s vocabulary, in this tab, in about a second', kind: 'toggle', get: () => _nlOn, set: (v) => { nlSetEnabled(v); if (v) nlEnsureTrained(); } },
];

export let _settingsWin = null, _settingsSec = 'display';

export function openSettingsWindow() {
  if (_settingsWin) { raiseWindow(_settingsWin.el); return; }
  const win = floatWin({ title: 'settings', sub: 'this machine', x: innerWidth / 2 - 280, y: 90, w: 560, h: 440, onClose: () => { _settingsWin = null; } });
  _settingsWin = win;
  win.body.style.cssText += 'display:flex;flex-direction:column';
  const split = document.createElement('div');
  split.style.cssText = 'flex:1;min-height:0;display:flex';
  const rail = document.createElement('div');
  rail.style.cssText = 'flex:0 0 118px;border-right:1px solid var(--border);padding:10px 0;display:flex;flex-direction:column;gap:1px;font-family:var(--mono);font-size:12px';
  const page = document.createElement('div');
  page.style.cssText = 'flex:1;min-width:0;overflow-y:auto;padding:12px 16px;font-family:var(--mono);font-size:12px';
  split.append(rail, page);
  const foot = document.createElement('div');
  foot.style.cssText = 'flex:0 0 auto;border-top:1px solid var(--border);background:var(--panel);padding:6px 16px;color:var(--dim);font-family:var(--mono);font-size:11px;line-height:1.45';
  foot.textContent = 'stored in this browser only — nothing leaves this machine (Sealed) · view state travels with the project; data decisions live in its manifests';
  win.body.append(split, foot);
  const SECS = [...new Set(PREFS.map((pr) => pr.sec)), 'housekeeping'];
  const renderRail = () => {
    rail.textContent = '';
    for (const sec of SECS) {
      const bt = document.createElement('button');
      const on = _settingsSec === sec;
      bt.style.cssText = 'text-align:left;background:none;border:none;font:inherit;cursor:pointer;padding:6px 14px;border-left:2px solid ' + (on ? 'var(--accent)' : 'transparent') + ';color:' + (on ? 'var(--accent)' : 'var(--muted)');
      bt.textContent = sec;
      bt.onclick = () => { _settingsSec = sec; renderRail(); renderPage(); };
      rail.appendChild(bt);
    }
  };
  const renderPage = () => {
    page.textContent = '';
    if (_settingsSec === 'housekeeping') {
      const mk = (label, title, fn) => {
        const wrap = document.createElement('div'); wrap.style.cssText = 'margin-bottom:14px';
        const bt = document.createElement('button'); bt.className = 'awin-btn'; bt.textContent = label; bt.onclick = fn;
        const d = document.createElement('div'); d.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5;margin-top:4px'; d.textContent = title;
        wrap.append(bt, d); page.appendChild(wrap);
      };
      mk('forget window layouts', 'clear every remembered per-kind window position and size — windows open at their defaults again', () => {
        try { for (const k of Object.keys(localStorage)) if (k.startsWith('micro.winGeo.')) localStorage.removeItem(k); } catch { /* private */ }
        $('#meta').textContent = 'window layouts forgotten — windows open at their defaults again';
      });
      mk('reset all preferences', 'every setting back to its default (window layouts and recents stay)', () => {
        try { for (const k of ['micro.bg', 'micro.edges', 'micro.budget', 'micro.selStick', 'micro.autoApply', 'micro.secFollow', 'micro.windingCpu', 'micro.pinBudget', 'micro.autoOptimize', 'micro.nl']) localStorage.removeItem(k); } catch { /* private */ }
        $('#meta').textContent = 'preferences reset — reload micro to see every default again';
      });
      return;
    }
    for (const pr of PREFS.filter((x) => x.sec === _settingsSec)) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:14px';
      const top = document.createElement('div');
      top.style.cssText = 'display:flex;align-items:center;gap:10px';
      const lab = document.createElement('span'); lab.style.cssText = 'flex:1;min-width:0;color:var(--text)'; lab.textContent = pr.label;
      top.appendChild(lab);
      if (pr.kind === 'toggle') {
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!pr.get();
        cb.onchange = () => { pr.set(cb.checked); };
        top.appendChild(cb);
      } else {
        const sel = document.createElement('select'); sel.className = 'sw-sel';
        const opts = typeof pr.opts === 'function' ? pr.opts() : pr.opts;
        for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
        const cur = String(pr.get());
        if (![...sel.options].some((o) => o.value === cur)) { const o = document.createElement('option'); o.value = cur; o.textContent = cur; sel.appendChild(o); }
        sel.value = cur;
        sel.onchange = () => { pr.set(sel.value); };
        top.appendChild(sel);
      }
      row.appendChild(top);
      if (pr.desc) {
        const d = document.createElement('div');
        d.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5;margin-top:3px;max-width:52ch';
        d.textContent = pr.desc;
        row.appendChild(d);
      }
      page.appendChild(row);
    }
  };
  renderRail(); renderPage();
}
