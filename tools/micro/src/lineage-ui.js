// micro — lineage on screen: the provenance tree of a derived layer as a window,
// and as a standalone HTML report.
import { fmtSize } from './paths.js';
import { floatWin, focusWindow } from './windows.js';
import { S } from './state.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setLineageUiHooks): deliverBlob
let H = {};
export function setLineageUiHooks(h) { H = h; }

// ── lineage inspector + report ────────────────────────────────────────────────
export const LINEAGE_LABEL = { open: 'opened', join: 'spatial join', reconcile: 'reconcile', optimize: 'optimize', keyjoin: 'key join', 'grid-cover': 'common grid', 'grid-new': 'new grid', export: 'export' };

export function lineageSummary(lin) {
  const p = lin.params || {};
  switch (lin.op) {
    case 'open': return lin.origin ? `${lin.origin.file}${lin.origin.bytes ? ` · ${fmtSize(lin.origin.bytes)}` : ''}` : 'file';
    case 'join': return `→ ${p.target || 'target'} grid · ${(p.columns || []).map((c) => c.out || c.name).join(', ')}`;
    case 'reconcile': return `${p.of || ''} on ${p.grade || ''} · common ${p.target === 'common-finest' ? 'finest' : ''}`;
    case 'optimize': return `→ Morton spatial Parquet${p.blocks ? ` · ${p.blocks.toLocaleString()} blocks` : ''}`;
    case 'keyjoin': return `${p.leftKey} = ${p.rightKey} · +${(p.bring || []).join(', ')} · ${p.dup}`;
    case 'grid-cover': return `${p.resolution} · ${(p.count || []).join('×')} @ ${(p.block || []).join('×')} m`;
    case 'grid-new': return `${(p.count || []).join('×')} @ ${(p.block || []).join('×')} m`;
    case 'export': return `${p.format}${p.codec ? ' ' + p.codec : ''}${p.filter ? ` · filter: ${p.filter}` : ''}${p.spatial ? ' · Morton' : ''}`;
    default: return '';
  }
}

export function renderLineageTree(container, lin, depth) {
  const row = document.createElement('div'); row.className = 'lin-row'; row.style.paddingLeft = (depth * 15 + 2) + 'px';
  const op = document.createElement('span'); op.className = 'lin-op'; op.textContent = LINEAGE_LABEL[lin.op] || lin.op;
  const sum = document.createElement('span'); sum.className = 'lin-sum'; sum.textContent = lineageSummary(lin);
  const when = document.createElement('span'); when.className = 'lin-when'; when.textContent = lin.at ? new Date(lin.at).toLocaleString() : '';
  when.title = lin.build ? `build ${lin.build}` : '';
  row.append(op, sum, when); container.appendChild(row);
  for (const s of lin.sources || []) renderLineageTree(container, s, depth + 1);
}

export const _linWins = new Map();

export function openLineageWindow(L) {
  if (!L || !L.lineage) { $('#meta').textContent = 'lineage: none recorded'; return; }
  const ex = _linWins.get(L.id); if (ex) { focusWindow(ex.el); return; }
  const win = floatWin({ title: `lineage · ${L.label || L.name}`, sub: '', x: 100, y: 110, w: 520, h: 320, onClose: () => _linWins.delete(L.id) });
  win.body.style.cssText += 'display:flex;flex-direction:column';
  const tree = document.createElement('div'); tree.className = 'lin-tree'; tree.style.cssText = 'flex:1;overflow:auto;padding:6px 4px';
  renderLineageTree(tree, L.lineage, 0);
  const foot = document.createElement('div'); foot.className = 'awin-ctrls rt';
  const cpy = document.createElement('button'); cpy.className = 'awin-btn'; cpy.textContent = 'Copy JSON'; cpy.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(L.lineage, null, 2)); $('#meta').textContent = 'lineage JSON copied'; };
  const rep = document.createElement('button'); rep.className = 'awin-btn btn-p'; rep.textContent = 'Export report (HTML)…'; rep.onclick = () => exportLineageReport(L);
  foot.append(cpy, rep);
  win.body.append(tree, foot);
  _linWins.set(L.id, win);
}

export function lineageReportHtml(L) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = [];
  const walk = (lin, depth) => {
    rows.push(`<tr><td style="padding-left:${depth * 20 + 6}px"><b>${esc(LINEAGE_LABEL[lin.op] || lin.op)}</b></td><td>${esc(lineageSummary(lin))}</td><td class="w">${lin.at ? esc(new Date(lin.at).toLocaleString()) : ''}</td><td class="w">${esc(lin.build || '')}</td></tr>`);
    for (const s of lin.sources || []) walk(s, depth + 1);
  };
  walk(L.lineage, 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>micro lineage — ${esc(L.label || L.name)}</title>
<style>body{font:13px/1.5 system-ui,sans-serif;color:#1a1a1a;max-width:900px;margin:2rem auto;padding:0 1rem}
h1{font-size:18px;border-bottom:2px solid #c8722e;padding-bottom:4px}.meta{color:#666;font-size:12px}
table{border-collapse:collapse;width:100%;margin-top:1rem;font-size:12px}td{border-bottom:1px solid #eee;padding:4px 8px;vertical-align:top}
td.w{color:#888;white-space:nowrap;font-family:monospace;font-size:11px}
details{margin-top:1.5rem}pre{background:#f6f6f4;padding:8px;overflow:auto;font-size:11px}</style></head>
<body><h1>Provenance — ${esc(L.label || L.name)}</h1>
<p class="meta">Derivation trail for a micro block model. Generated ${esc(new Date().toLocaleString())} · micro ${esc(S.build)}.</p>
<table><thead><tr><td><b>step</b></td><td><b>detail</b></td><td class="w">when</td><td class="w">build</td></tr></thead><tbody>${rows.join('')}</tbody></table>
<details><summary>machine-readable lineage (JSON)</summary><pre>${esc(JSON.stringify(L.lineage, null, 2))}</pre></details>
</body></html>`;
}

export function exportLineageReport(L) {
  if (!L || !L.lineage) return;
  const blob = new Blob([lineageReportHtml(L)], { type: 'text/html' });
  const name = (L.label || L.name).replace(/\.[^.]+$/, '') + '.lineage.html';
  H.deliverBlob(blob, name);
  window._lastReport = blob;
  $('#meta').textContent = `lineage report → ${name}`;
}
