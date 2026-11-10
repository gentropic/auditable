// micro — rename a layer, or many at once by pattern.
import { microPrompt } from './prompts.js';
import { fileLayerByPath, renderLayers } from './tree.js';
import { markProjectDirty } from './project.js';
import { setHTML, trusted } from './html.js';
const $ = (s) => document.querySelector(s);

// scrub the section by one slab thickness (adjacent section, like flipping pages)
// rename the layer's DISPLAY LABEL (the source name stays load-bearing for
// save/reload). F2 (the Windows reflex) + the layer context menu + palette.
export async function renameActiveLayer(L) {
  if (!L) return;
  const v = await microPrompt('layer name — a path files it into groups (swaths/FE drift)', L.label || L.name);
  if (!v || !v.trim()) return;
  const moved = fileLayerByPath(L, v.trim());              // "a/b" → group a, label b; a plain name just renames
  if (!moved) { renderLayers(); markProjectDirty(); }
  else $('#meta').textContent = `${L.label} → filed under ${v.trim().split('/').slice(0, -1).join('/')}`;
}

// BATCH RENAME (a group / a multi-selection / all layers): strip the common
// prefix/suffix in one click, or find→replace (plain or regex), with a live
// before → after table. Labels only — source names stay load-bearing.
export function openBatchRename(Ls) {
  Ls = (Ls || []).filter(Boolean);
  if (Ls.length < 2) { $('#meta').textContent = 'rename layers: needs two or more layers'; return; }
  const body = $('#brDlgBody'); body.textContent = '';
  // base = names after committed strip ops; the find/replace previews ON TOP
  let base = Ls.map((L) => L.label || L.name);
  const commonPrefix = (arr) => { let p = arr[0] || ''; for (const s of arr) { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); } return p; };
  const commonSuffix = (arr) => { let p = arr[0] || ''; for (const s of arr) { let i = 0; while (i < p.length && i < s.length && p[p.length - 1 - i] === s[s.length - 1 - i]) i++; p = p.slice(p.length - i); } return p; };
  const ops = document.createElement('div'); ops.className = 'br-ops';
  const find = document.createElement('div'); find.className = 'br-find';
  const fIn = document.createElement('input'); fIn.type = 'text'; fIn.placeholder = 'find…';
  const arrow = document.createElement('span'); arrow.textContent = '→';
  const rIn = document.createElement('input'); rIn.type = 'text'; rIn.placeholder = 'replace with (blank = remove)';
  const rxL = document.createElement('label'); const rxC = document.createElement('input'); rxC.type = 'checkbox'; rxL.append(rxC, document.createTextNode('regex')); rxL.title = 'find is a regular expression (g flag); replace may use $1 groups';
  find.append(fIn, arrow, rIn, rxL);
  const err = document.createElement('div'); err.className = 'br-err';
  const tbl = document.createElement('table');
  body.append(ops, find, err, tbl);
  let preview = base.slice();
  const applyFind = (names) => {
    err.textContent = '';
    const f = fIn.value; if (!f) return names.slice();
    try {
      const re = rxC.checked ? new RegExp(f, 'g') : null;
      return names.map((s) => (re ? s.replace(re, rIn.value) : s.split(f).join(rIn.value)));
    } catch (e) { err.textContent = `regex: ${e.message}`; return names.slice(); }
  };
  const rebuild = () => {
    preview = applyFind(base).map((s, i) => (s.trim() ? s.trim() : base[i]));   // an emptied name keeps its base
    // strip buttons recompute against the CURRENT base (chainable)
    ops.textContent = '';
    const pre = commonPrefix(base), suf = commonSuffix(base);
    const mkStrip = (label, fn) => { const b2 = document.createElement('button'); b2.textContent = label; b2.onclick = () => { base = base.map(fn).map((s, i) => (s.trim() ? s.trim() : base[i])); rebuild(); }; ops.append(b2); };
    if (pre.length >= 2 && pre.length < Math.min(...base.map((s) => s.length))) mkStrip(`✂ prefix “${pre.length > 18 ? pre.slice(0, 17) + '…' : pre}”`, (s) => s.slice(pre.length));
    if (suf.length >= 2 && suf.length < Math.min(...base.map((s) => s.length))) mkStrip(`✂ suffix “${suf.length > 18 ? '…' + suf.slice(-17) : suf}”`, (s) => s.slice(0, s.length - suf.length));
    if (!ops.children.length) { const n = document.createElement('span'); n.style.color = 'var(--dim)'; n.textContent = 'no common prefix/suffix'; ops.append(n); }
    setHTML(tbl, trusted('<tr><th>before</th><th>after</th></tr>'));
    Ls.forEach((L, i) => {
      const from = L.label || L.name, to = preview[i];
      const tr = document.createElement('tr');
      const t1 = document.createElement('td'); t1.textContent = from; t1.title = from;
      const t2 = document.createElement('td'); t2.textContent = to; t2.title = to; t2.className = to !== from ? 'after' : 'same';
      tr.append(t1, t2); tbl.append(tr);
    });
    const changed = Ls.filter((L, i) => preview[i] !== (L.label || L.name)).length;
    $('#brDlgMsg').textContent = changed ? `${changed} of ${Ls.length} change` : 'no changes yet';
    $('#brGo').textContent = changed ? `Apply (${changed})` : 'Apply';
  };
  fIn.oninput = rIn.oninput = rebuild;
  rxC.onchange = rebuild;
  const close = () => { $('#brDlg').classList.remove('show'); $('#brGo').onclick = $('#brNot').onclick = $('#brCancel').onclick = null; };
  $('#brGo').onclick = () => {
    let n2 = 0;
    Ls.forEach((L, i) => { const to = preview[i]; if (to && to !== (L.label || L.name)) { L.label = to; n2++; } });
    close();
    if (n2) { renderLayers(); markProjectDirty(); $('#meta').textContent = `renamed ${n2} layer${n2 > 1 ? 's' : ''}`; }
  };
  $('#brNot').onclick = close;
  $('#brCancel').onclick = close;
  rebuild();
  $('#brDlg').classList.add('show');
}
