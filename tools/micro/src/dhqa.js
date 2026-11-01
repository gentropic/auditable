// micro drillhole QA — the QA report of a drillhole SET: every row a reviewer has
// to look at before the holes go into an estimate, read from the set's own files
// (@gcu/condenser drillholeQa → @gcu/drillhole qa). A float window: the checks
// that fired (click one to show only it), the findings table (click a row → the
// camera goes to that hole and its intervals are selected), the values census of
// every interval column, the limits as knobs, and a TSV export that says what it
// was run on. Nothing here changes a table.
import { drillholeQa } from '../../../ext/condenser/src/main.js';
import { floatWin } from './windows.js';
import { basename } from './paths.js';
import { mkLineage } from './lineage.js';
// the app's side, passed in once (setDhQaHooks): members(nd) → the set's dh
// layers, setName(nd), zoomToHole(L, bhid) → bool, selectHoles(members, bhids),
// deliverBlob(blob, filename)
let H = {};
export function setDhQaHooks(h) { H = h; }

const SEV = { error: ['error', '#c0584a'], warn: ['warning', '#c8a43c'], info: ['info', 'var(--info)'] };   // fault red · caution yellow · info blue
const ROW_CAP = 2000;                                      // rows drawn at once (the export carries all)
export const _qaWins = new Map();                          // set key → window

// the inputs of one run: the shared collar + survey, every member's interval table
function inputsOf(members) {
  const d0 = members[0].docs.dhDoc, maps = (d0.config && d0.config.mappings) || {};
  return {
    files: {
      collar: d0.blobs.collar, survey: d0.blobs.survey,
      intervals: members.map((L) => ({
        blob: L.docs.dhDoc.blobs.intervals,
        name: basename(L.docs.dhDoc.blobs.intervals.name || L.name || 'intervals'),
        mapping: (L.docs.dhDoc.config && L.docs.dhDoc.config.mappings && L.docs.dhDoc.config.mappings.intervals) || null,
      })),
    },
    mappings: { collar: maps.collar || null, survey: maps.survey || null },
    dipConvention: (d0.config && d0.config.dipConvention) || 'auto',
  };
}

export async function openDhQa(nd) {
  const members = H.members(nd);
  if (!members.length) return null;
  const key = members[0]._setKey || 'solo:' + members[0].id;
  const open = _qaWins.get(key);
  if (open && open.el.isConnected) { open.rerun(); return open; }
  const st = { doglegMax: 10, gapMin: 0.001, extrapMax: 30, check: null, table: '', hole: '', tab: 'findings', r: null, err: null, running: false };
  const win = floatWin({ title: `drillhole QA · ${H.setName(nd)}`, sub: 'reading the set…', x: Math.max(12, innerWidth - 860), y: 96, w: 840, h: 460,
    onClose: () => { _qaWins.delete(key); } });
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main';
  body.append(rail, main);

  // ── the rail: limits, then the checks that fired ──
  const num = (label, k, title) => {
    const row = document.createElement('div'); row.className = 'sw-row'; row.title = title;
    const s = document.createElement('span'); s.textContent = label;
    const i = document.createElement('input'); i.className = 'sw-in sw-num'; i.type = 'number'; i.step = 'any'; i.value = String(st[k]);
    i.onchange = () => { const v = +i.value; if (Number.isFinite(v) && v >= 0) { st[k] = v; run(); } else i.value = String(st[k]); };
    row.append(s, i); return row;
  };
  const limH = document.createElement('div'); limH.className = 'sw-h'; limH.textContent = 'limits';
  const checksH = document.createElement('div'); checksH.className = 'sw-h'; checksH.textContent = 'checks';
  const checksEl = document.createElement('div'); checksEl.className = 'qa-checks';
  rail.append(limH,
    num('dogleg °/30', 'doglegMax', 'a survey interval bending faster than this is flagged (degrees per 30 length units)'),
    num('gap ≥', 'gapMin', 'a gap between consecutive intervals at least this long is flagged'),
    num('past survey >', 'extrapMax', 'an interval deeper than the deepest survey station by more than this is noted'),
    checksH, checksEl);

  // ── the main column: tabs, filters, the table, the foot ──
  const tabs = document.createElement('div'); tabs.className = 'sw-tabs';
  const tab = (id, label) => { const b = document.createElement('button'); b.className = 'sw-tab'; b.textContent = label; b.onclick = () => { st.tab = id; render(); }; b.dataset.tab = id; tabs.append(b); return b; };
  tab('findings', 'findings'); tab('values', 'values');
  const bar = document.createElement('div'); bar.className = 'sw-row qa-bar';
  const tblSel = document.createElement('select'); tblSel.className = 'sw-sel'; tblSel.onchange = () => { st.table = tblSel.value; render(); };
  const holeIn = document.createElement('input'); holeIn.className = 'sw-in'; holeIn.placeholder = 'hole ID…'; holeIn.oninput = () => { st.hole = holeIn.value.trim(); render(); };
  bar.append(tblSel, holeIn);
  const list = document.createElement('div'); list.className = 'qa-list';
  const foot = document.createElement('div'); foot.className = 'sw-row qa-foot';
  const note = document.createElement('span'); note.className = 'qa-note';
  const expB = document.createElement('button'); expB.textContent = 'export TSV'; expB.title = 'every finding (not just the ones shown), with what the report was run on';
  expB.onclick = () => exportTsv();
  foot.append(note, expB);
  main.append(tabs, bar, list, foot);

  const shown = () => {
    if (!st.r) return [];
    const h = st.hole.toLowerCase();
    return st.r.findings.filter((f) => (!st.check || f.check === st.check) && (!st.table || f.table === st.table) && (!h || String(f.bhid).toLowerCase().includes(h)));
  };
  const fmtD = (v) => (v == null || !Number.isFinite(v) ? '' : String(Math.round(v * 1000) / 1000));
  const cell = (tr, text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.append(td); return td; };

  function renderChecks() {
    checksEl.textContent = '';
    if (!st.r) return;
    if (!st.r.summary.length) { const d = document.createElement('div'); d.className = 'qa-clean'; d.textContent = '✓ nothing to report'; checksEl.append(d); return; }
    for (const s of st.r.summary) {
      const b = document.createElement('button'); b.className = 'qa-check' + (st.check === s.check ? ' on' : '');
      b.title = `${s.label} — ${s.count} row${s.count === 1 ? '' : 's'} in ${s.holes} hole${s.holes === 1 ? '' : 's'} (click to show only these)`;
      const dot = document.createElement('i'); dot.style.background = SEV[s.severity][1];
      const l = document.createElement('span'); l.textContent = s.label;
      const c = document.createElement('b'); c.textContent = s.count.toLocaleString();
      b.append(dot, l, c);
      b.onclick = () => { st.check = st.check === s.check ? null : s.check; render(); };
      checksEl.append(b);
    }
  }
  function renderFindings() {
    const rows = shown();
    const tbl = document.createElement('table'); tbl.className = 'st-tbl qa-tbl';
    const hr = document.createElement('tr');
    for (const h of ['', 'table', 'row', 'hole', 'from', 'to', 'check', 'detail']) { const th = document.createElement('th'); th.textContent = h; hr.append(th); }
    tbl.append(hr);
    for (const f of rows.slice(0, ROW_CAP)) {
      const tr = document.createElement('tr');
      const sev = cell(tr, '●', 'qa-sev'); sev.style.color = SEV[f.severity][1]; sev.title = SEV[f.severity][0];
      cell(tr, f.table);
      cell(tr, f.row == null ? '—' : String(f.row + 1), 'num');
      cell(tr, f.bhid || '(none)');
      cell(tr, fmtD(f.from), 'num'); cell(tr, fmtD(f.to), 'num');
      cell(tr, f.check);
      cell(tr, f.detail);
      tr.title = 'click: go to this hole and select its intervals';
      tr.onclick = () => goTo(f.bhid);
      tbl.append(tr);
    }
    list.append(tbl);
    const n = st.r.findings.length;
    note.textContent = rows.length === n ? `${n.toLocaleString()} finding${n === 1 ? '' : 's'}` : `${rows.length.toLocaleString()} of ${n.toLocaleString()} shown`;
    if (rows.length > ROW_CAP) note.textContent += ` · first ${ROW_CAP.toLocaleString()} drawn (the export has all)`;
  }
  function renderValues() {
    const tbl = document.createElement('table'); tbl.className = 'st-tbl qa-tbl';
    const hr = document.createElement('tr');
    for (const h of ['table', 'column', 'rows', 'blank', 'numbers', '<x', '>x', 'codes', 'text']) { const th = document.createElement('th'); th.textContent = h; hr.append(th); }
    tbl.append(hr);
    for (const v of st.r.values.filter((x) => !st.table || x.table === st.table)) {
      const tr = document.createElement('tr');
      cell(tr, v.table); cell(tr, v.column);
      for (const k of ['rows', 'blank', 'num', 'below', 'above', 'code', 'text']) {
        const td = cell(tr, v[k] ? v[k].toLocaleString() : '', 'num');
        if (k === 'text' && v.numeric && v.text) { td.style.color = SEV.warn[1]; td.title = `a column of numbers holding text — first at row ${v.firstText + 1}: “${v.textSample}” (reads as blank)`; }
      }
      tbl.append(tr);
    }
    list.append(tbl);
    note.textContent = 'every interval column but the hole ID and depths · <x / >x = below / above detection';
  }
  function render() {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === st.tab);
    holeIn.style.display = st.tab === 'values' ? 'none' : '';
    list.textContent = '';
    renderChecks();
    if (st.err) { const d = document.createElement('div'); d.className = 'st-empty'; d.textContent = st.err; list.append(d); note.textContent = ''; return; }
    if (!st.r) { const d = document.createElement('div'); d.className = 'st-empty'; d.textContent = 'reading the set…'; list.append(d); return; }
    const tables = ['collar', 'survey', ...st.r.tables.intervals.map((t) => t.name)];
    if (tblSel.options.length !== tables.length + 1) {
      tblSel.textContent = '';
      for (const [v, l] of [['', 'all tables'], ...tables.map((t) => [t, t])]) { const o = document.createElement('option'); o.value = v; o.textContent = l; tblSel.append(o); }
      tblSel.value = st.table;
    }
    if (st.tab === 'values') renderValues(); else renderFindings();
    const by = { error: 0, warn: 0, info: 0 };
    for (const f of st.r.findings) by[f.severity]++;
    win.sub.textContent = `${st.r.holes.toLocaleString()} holes · ${by.error} error${by.error === 1 ? '' : 's'} · ${by.warn} warning${by.warn === 1 ? '' : 's'} · ${by.info} note${by.info === 1 ? '' : 's'} · dip ${st.r.dipConvention}`;
  }
  async function goTo(bhid) {
    if (!bhid) return;
    const L = H.members(nd)[0]; if (!L) return;
    const ok = H.zoomToHole(L, bhid);
    H.selectHoles(H.members(nd), new Set([bhid]));
    if (!ok) note.textContent = `${bhid}: not placed (no usable collar) — nothing to go to`;
  }
  function exportTsv() {
    if (!st.r) return;
    const inp = inputsOf(H.members(nd));
    const lin = mkLineage('drillhole-qa', { doglegMax: st.doglegMax, gapMin: st.gapMin, extrapMax: st.extrapMax, dipConvention: st.r.dipConvention },
      [inp.files.collar, inp.files.survey, ...inp.files.intervals.map((t) => t.blob)].map((b) => ({ file: b.name || '', bytes: b.size || 0 })));
    const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
    const lines = [
      `# micro drillhole QA · ${clean(H.setName(nd))} · ${new Date(lin.at).toISOString()} · build ${lin.build || ''}`,
      `# files: ${lin.sources.map((s) => `${s.file} (${s.bytes} B)`).join(' · ')}`,
      `# limits: dogleg ${st.doglegMax}°/30 · gap ≥ ${st.gapMin} · past survey > ${st.extrapMax} · dip ${st.r.dipConvention} · rows are data rows, 1 = the first after the header`,
      ['severity', 'check', 'table', 'row', 'hole', 'from', 'to', 'detail'].join('\t'),
    ];
    for (const f of st.r.findings) lines.push([f.severity, f.check, f.table, f.row == null ? '' : f.row + 1, f.bhid, fmtD(f.from), fmtD(f.to), f.detail].map(clean).join('\t'));
    H.deliverBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/tab-separated-values' }), `${H.setName(nd).replace(/[^\w.-]+/g, '_')}-qa.tsv`);
  }
  async function run() {
    if (st.running) return;
    st.running = true; st.err = null;
    win.sub.textContent = 'checking…'; win.sub.classList.add('busy');
    try {
      const inp = inputsOf(H.members(nd));
      st.r = await drillholeQa(inp.files, { mappings: inp.mappings, dipConvention: inp.dipConvention, doglegMax: st.doglegMax, gapMin: st.gapMin, extrapMax: st.extrapMax });
    } catch (e) { st.err = `QA: ${e.message || e}`; st.r = null; }
    finally { st.running = false; win.sub.classList.remove('busy'); }
    render();
  }
  const handle = { el: win.el, rerun: run, state: st };
  win.el._qa = handle;                                     // the smokes read st.r
  _qaWins.set(key, handle);
  render();
  await run();
  return handle;
}
