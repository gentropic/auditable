// micro — DOWN-HOLE COMPOSITES: one interval table of a drillhole set re-cut into
// equal lengths, the way samples go into an estimate (and into a fair comparison
// with a block model — like support with like). The maths is @gcu/drillhole's
// composite, through condenser's drillholeComposite over the set's own files:
// numbers length-weighted (mass-weighted when a density column is named), text by
// majority of covered length, composites restarting where a domain column changes,
// short leftovers kept with their SUPPORT (or dropped below a minimum length, and
// counted). The result is a new POINTS layer — each composite at the centroid of
// its covered length on the desurveyed path — carrying BHID, FROM, TO, SUPPORT and
// every interval column; it saves with the project like any derived layer.
import { drillholeComposite } from '../../../ext/condenser/src/main.js';
import { floatWin, focusWindow } from './windows.js';
import { basename } from './paths.js';
import { mkLineage } from './lineage.js';
import { layerById } from './state.js';
import { groupLayerIds } from './tree.js';
import { openBlob } from './open.js';
import { deliverBlob } from './hostio.js';
import { registerCommands } from './commands.js';
const $ = (s) => document.querySelector(s);

const dhMembers = (Lorg) => {
  if (Lorg && Lorg.group) return groupLayerIds(Lorg).map(layerById).filter((L) => L && L.dh && L.docs.dhDoc && !L.trace);
  return Lorg && Lorg.dh && Lorg.docs.dhDoc ? [Lorg] : [];
};

// the inputs condenser wants, from one member (interval table) of a set
function inputsOf(L) {
  const d = L.docs.dhDoc, maps = (d.config && d.config.mappings) || {};
  return {
    files: { collar: d.blobs.collar, survey: d.blobs.survey, intervals: d.blobs.intervals },
    opts: {
      mappings: { collar: maps.collar || d.header.collarMapping || null, survey: maps.survey || d.header.surveyMapping || null, intervals: maps.intervals || d.header.intervalMapping || null },
      dipConvention: (d.config && d.config.dipConvention) || 'auto',
      method: (d.config && d.config.method) || d.header.method || 'minimumCurvature',
      qualify: L.qualify || null,
    },
  };
}

const csvCell = (v) => { if (v == null) return ''; if (typeof v === 'number') return Number.isFinite(v) ? String(+v.toPrecision(10)) : ''; const t = String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/**
 * Composite one interval table → { header, rows, report, csv }. opts: length (blank =
 * the commonest interval length), splitCols, densityCol, minCoverage (0..1).
 */
export async function compositeLayer(L, opts = {}) {
  const inp = inputsOf(L);
  const r = await drillholeComposite(inp.files, { ...inp.opts, length: opts.length, splitCols: opts.splitCols || null, densityCol: opts.densityCol || null, minSupport: opts.minSupport || null });
  r.csv = [r.header.map(csvCell).join(','), ...r.rows.map((row) => row.map(csvCell).join(','))].join('\n') + '\n';
  return r;
}

/** Composite and open the result as a points layer. Resolves to the new layer's id. */
export async function compositeToLayer(L, opts = {}) {
  const r = await compositeLayer(L, opts);
  if (!r.rows.length) throw new Error('no composites — no interval was placed on a hole');
  const ivName = basename((L.docs.dhDoc.blobs.intervals && L.docs.dhDoc.blobs.intervals.name) || L.name).replace(/\.[^.]+$/, '');
  const len = +(+r.report.length).toFixed(3);
  const name = `${ivName}-comp${len}m.csv`;
  // chan = the first numeric interval column (or SUPPORT), cat = the first text one
  const nNum = (j) => r.rows.some((row) => typeof row[j] === 'number');
  let chan = 6, cat = null;
  for (let j = 7; j < r.header.length; j++) { if (nNum(j)) { chan = j; break; } }
  for (let j = 7; j < r.header.length; j++) { if (!nNum(j) && r.rows.some((row) => row[j] != null)) { cat = j; break; } }
  const lineage = mkLineage('composite', { length: len, splitCols: opts.splitCols || [], densityCol: opts.densityCol || null, minSupport: opts.minSupport || null, method: inputsOf(L).opts.method },
    [{ name: L.label || L.name, kind: 'drillholes' }]);
  const id = await openBlob(new File([r.csv], name, { type: 'text/csv' }), name, 'add', null, { mapping: { x: 1, y: 2, z: 3, chan, cat }, asKind: 'points', lineage });
  const NL = layerById(id);
  if (NL) { NL.memoryOnly = true; NL.composites = { of: L.label || L.name, length: len }; }
  return { id, report: r.report, name };
}

let _win = null;
export function openComposite(target) {
  const members = dhMembers(target);
  if (!members.length) { $('#meta').textContent = 'composite: needs a drillhole layer'; return null; }
  if (_win && _win.el.isConnected) _win.close();
  const win = floatWin({ title: 'composite', sub: (target.group ? target.name : (target.label || target.name)) || 'drillholes', x: Math.max(12, innerWidth - 400), y: 100, w: 360, h: 380, onClose: () => { _win = null; } });
  _win = win;
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px;overflow-y:auto';
  const row = (label, el, title) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; if (title) r.title = title; const s = document.createElement('span'); s.style.cssText = 'flex:0 0 96px;color:var(--text)'; s.textContent = label; r.append(s, el); win.body.appendChild(r); return el; };
  const tblSel = document.createElement('select'); tblSel.className = 'sw-sel';
  members.forEach((L, k) => tblSel.append(new Option(L.label || L.name, String(k))));
  if (members.length > 1) row('table', tblSel, 'which interval table to composite');
  const lenIn = document.createElement('input'); lenIn.className = 'sw-in'; lenIn.placeholder = 'auto (commonest length)'; lenIn.style.flex = '1';
  row('length', lenIn, 'composite length, in the holes’ depth units — blank: the commonest interval length');
  const splitBox = document.createElement('div'); splitBox.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 10px';
  const densSel = document.createElement('select'); densSel.className = 'sw-sel';
  const covIn = document.createElement('input'); covIn.className = 'sw-in'; covIn.type = 'number'; covIn.min = '0'; covIn.max = '100'; covIn.step = '5'; covIn.value = '0'; covIn.style.width = '64px';
  const fillCols = () => {
    const L = members[+tblSel.value || 0], h = L.docs.dhDoc.header, im = h.intervalMapping || {};
    const keys = new Set([im.bhid, im.from, im.to]);
    const num = new Set((h.numericColumns || []).map((c) => c.i));
    splitBox.textContent = ''; densSel.textContent = ''; densSel.append(new Option('none (length-weighted)', ''));
    h.columns.forEach((name, i) => {
      if (keys.has(i)) return;
      if (num.has(i)) { densSel.append(new Option(name, name)); if (/^(dens|density|sg|bd|rho)$/i.test(String(name).trim())) densSel.value = name; return; }
      const lb = document.createElement('label'); lb.style.cssText = 'display:flex;gap:4px;align-items:center;color:var(--text)';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = name; lb.append(cb, name); splitBox.append(lb);
    });
    if (!splitBox.childNodes.length) splitBox.textContent = '(no text columns)';
  };
  tblSel.onchange = fillCols;
  row('break at', splitBox, 'composites restart where any of these columns changes (domain boundaries)');
  row('density', densSel, 'weight numeric grades by length × density (the density itself stays length-weighted)');
  row('min length %', covIn, 'drop a composite whose sampled length (SUPPORT) is below this share of the composite length — the short leftovers at contacts and hole ends, and windows mostly in a gap. 0 keeps them all; each keeps its SUPPORT');
  fillCols();
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  note.textContent = 'a new points layer: each composite at the centre of its covered length on the hole, with BHID, FROM, TO, SUPPORT and every interval column';
  win.body.appendChild(note);
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Composite';
  const csvB = document.createElement('button'); csvB.className = 'awin-btn'; csvB.textContent = 'export .csv'; csvB.title = 'composite and save the table, without adding a layer';
  const msg = document.createElement('span'); msg.style.cssText = 'flex:1;color:var(--muted)';
  bar.append(go, csvB, msg); win.body.appendChild(bar);
  const optsNow = () => {
    const len = parseFloat(String(lenIn.value).replace(',', '.'));
    return { length: len > 0 ? len : undefined, splitCols: [...splitBox.querySelectorAll('input:checked')].map((c) => c.value), densityCol: densSel.value || null, minSupport: (+covIn.value || 0) / 100 || null };
  };
  const report = (r) => `${r.composites.toLocaleString()} composites of ${r.length} from ${r.holes} holes${r.short ? ` · ${r.short} shorter than the minimum dropped` : ''}`;
  go.onclick = async () => {
    go.disabled = true; msg.textContent = 'compositing…';
    try {
      const L = members[+tblSel.value || 0];
      const res = await compositeToLayer(L, optsNow());
      msg.textContent = report(res.report);
      $('#meta').textContent = `composites: ${res.name} — ${report(res.report)}`;
    } catch (e) { msg.textContent = e.message; }
    finally { go.disabled = false; }
  };
  csvB.onclick = async () => {
    csvB.disabled = true; msg.textContent = 'compositing…';
    try {
      const L = members[+tblSel.value || 0];
      const r = await compositeLayer(L, optsNow());
      const nm = `${basename(L.docs.dhDoc.blobs.intervals.name || L.name).replace(/\.[^.]+$/, '')}-comp${+(+r.report.length).toFixed(3)}m.csv`;
      deliverBlob(new Blob([r.csv], { type: 'text/csv' }), nm);
      msg.textContent = `${report(r.report)} → ${nm}`;
    } catch (e) { msg.textContent = e.message; }
    finally { csvB.disabled = false; }
  };
  return win;
}

export { dhMembers };

// ── its palette commands (src/commands.js; the palette order is src/command-list.js) ──
registerCommands([
  { id: 'composite', group: 'Analysis', title: 'Composite drillholes…', kw: 'downhole composites fixed length regularize support domain break density weighted samples', when: (c) => !!(c.L && c.L.dh && c.L.docs.dhDoc && !c.L.trace && c.L.viewOf == null), run: (c) => openComposite(c.L) },
]);
