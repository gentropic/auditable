// lamina, DD-60 edition — the DADA Diskman reading a file of any size the way lamina does: a block index from
// one streamed pass, rows read in windows, never the whole file in memory. A toy, honestly: the grid on the
// LCD, the d-pad to move, and five F-keys — FILTER (lamina's language, a streaming scan), GO TO, RAW (the
// row's line as the file has it), STATS (the column, one scan) and MENU. Sealed: no network at all.
import { mountDD60 } from '../../../ext/dd60/chrome.js';
import { detectKind, buildFileSource, buildMemorySource, createRecordViewSource, createResultView, scanFilter, scanColumnStats,
  parseNum, recordOffset, splitRecordsPos, visibleText, LOADING } from '@gcu/lamina';
import { validate, compileBool } from '@gcu/expr';

const dev = mountDD60(document.body, { tabs: [['filter', 'FILTER'], ['goto', 'GO TO'], ['raw', 'RAW'], ['stats', 'STATS'], ['menu', 'MENU']] });
const screen = dev.screen, ov = dev.overlay;
const fmt = (n) => (n == null ? '—' : typeof n === 'number' ? (Number.isInteger(n) ? n.toLocaleString('en-US') : (Math.abs(n) >= 1e6 || (n !== 0 && Math.abs(n) < 1e-4) ? n.toExponential(4) : String(+n.toPrecision(6)))) : String(n));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ── the open file ────────────────────────────────────────────────────────────────────────────────────────
let T = null;            // { name, file|bytes, src, d, schema, dataStart, base, view, filter, fr, encoding, marks:Set }
let cur = 0, col = 0, top = 0;
let busy = null;         // an AbortController while a scan runs
const ROWS = 15;         // data rows on the screen

function empty(msg) {
  screen.innerHTML = `<div class="lmsg" id="emptyMsg">${msg || `<div><b>no disc</b></div><div>MENU (F5) → OPEN FILE, or tap here.<br>On a computer, drop a file anywhere.</div><div>Any size: lamina reads it in windows and never holds it all.</div><div>MENU → OPEN SAMPLE for 120,000 rows of a block model.</div>`}</div>`;
  const e = screen.querySelector('#emptyMsg'); if (e && !T) e.onclick = pickFile;
  dev.status('DADA DISKMAN', '');
}
function progress(label, f) {
  screen.innerHTML = `<div class="lmsg"><div><b>${esc(label)}</b> ${Math.round(100 * f)}%</div><div class="bar"><i style="width:${(100 * f).toFixed(1)}%"></i></div><div style="color:var(--lcd-dim)">NO cancels</div></div>`;
}

async function openFile(file, encoding) {
  closeOv();
  if (busy) busy.abort();
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const d = detectKind(head, { name: file.name, force: encoding ? { encoding } : undefined });
  if (d.kind === 'binary') { T = null; empty(`<div><b>${esc(file.name)}</b></div><div>not a table or a text — lamina (the full one) shows its bytes in hex.</div>`); return; }
  d.encoding = encoding;
  dev.status(file.name, 'reading…'); dev.led(true); progress('READING', 0);
  let src;
  try {
    src = file._sampleBytes                        // (not file.bytes: a Blob has a bytes() METHOD in modern browsers)
      ? buildMemorySource(file._sampleBytes, { kind: d.kind, delimiter: d.delimiter || ',', quote: d.quote || '"', encoding })
      : await buildFileSource(file, { kind: d.kind, delimiter: d.delimiter || ',', quote: d.quote || '"', encoding, onProgress: (r, t) => progress('READING', t ? r / t : 0) });
  } catch (e) { dev.led(false); empty(`<div><b>couldn't read it</b></div><div>${esc(e.message || e)}</div>`); return; }
  dev.led(false);
  const schema = d.kind === 'delimited' ? d.schema : [{ name: 'line', type: 'string' }];
  const dataStart = d.dataStart != null ? d.dataStart : (d.kind === 'delimited' && d.hasHeader ? 1 : 0);
  const base = createRecordViewSource(src, { schema, dataStart });
  T = { name: file.name, file, src, d, schema, dataStart, base, view: base, filter: '', fr: null, encoding, marks: new Set() };
  base.onReady(() => render());
  cur = 0; col = 0; top = 0;
  render();
}

// ── the grid on the LCD ──────────────────────────────────────────────────────────────────────────────────
const SCREEN_CH = 50;                                  // characters across the LCD at 11 px Space Mono
function widths(rows) {
  return T.schema.map((s, c) => {
    let w = Math.min(14, Math.max(3, String(s.name).length));
    for (const r of rows) if (r && r !== LOADING) w = Math.min(14, Math.max(w, String(r[c] ?? '').length));
    return w;
  });
}
function cell(v, w, num) { let s = String(v ?? ''); if (s.length > w) s = s.slice(0, w - 1) + '…'; return num ? s.padStart(w) : s.padEnd(w); }
function render() {
  if (!T) return;
  const vs = T.view, n = vs.rowCount();
  cur = Math.max(0, Math.min(n - 1, cur));
  if (cur < top) top = cur; if (cur >= top + ROWS) top = cur - ROWS + 1;
  const rows = []; for (let r = top; r < Math.min(n, top + ROWS); r++) rows.push(vs.rowAt(r));
  const w = widths(rows), nc = T.schema.length;
  col = Math.max(0, Math.min(nc - 1, col));
  const rnW = Math.max(4, String(T.base.rowCount()).length);
  // the columns that fit, the current one always among them
  let first = 0, used;
  for (first = 0; first <= col; first++) {
    used = rnW + 2; let k = first; while (k < nc && used + w[k] + 1 <= SCREEN_CH) { used += w[k] + 1; k++; }
    if (k > col) break;
  }
  const shown = []; used = rnW + 2;
  for (let k = first; k < nc && used + w[k] + 1 <= SCREEN_CH; k++) { shown.push(k); used += w[k] + 1; }
  if (!shown.length) shown.push(col);
  const isNum = (k) => T.schema[k].type === 'number';
  let h = `<div class="hd">${' '.repeat(rnW + 2)}` + shown.map((k) => { const t = cell(T.schema[k].name, w[k], isNum(k)); return k === col ? `<span class="cc">${esc(t)}</span>` : esc(t); }).join(' ') + '</div>';
  for (let i = 0; i < ROWS; i++) {
    const r = top + i; if (r >= n) { h += '<div class="r"> </div>'; continue; }
    const row = rows[i], rec = vs.rowHeaderAt ? vs.rowHeaderAt(r) : r + 1, mk = T.marks.has(rec);
    const lead = `<span class="rn">${String(rec).padStart(rnW)}</span>${mk ? '<span class="bm">▸</span>' : ' '} `;
    const body = row === LOADING || !row ? '<span class="rn">…</span>' : shown.map((k) => { const t = esc(cell(row[k], w[k], isNum(k))); return k === col ? `<span class="cc">${t}</span>` : t; }).join(' ');
    h += `<div class="r${r === cur ? ' cur' : ''}">${lead}${body}</div>`;
  }
  screen.innerHTML = `<div class="lgrid">${h}</div>`;
  const total = T.base.rowCount();
  dev.status(T.name, `${(cur + 1).toLocaleString('en-US')}/${n.toLocaleString('en-US')}${T.fr ? ` of ${total.toLocaleString('en-US')} F` : ''}`);
}

// ── overlays: the F-keys ────────────────────────────────────────────────────────────────────────────────
let OV = null;            // { id, items?, sel, input?, onYes?, mode }
const MODES = ['abc', 'ABC', '123', 'SYM'];
const SYM = { Q: '>', W: '<', E: '=', R: '!', T: '"', Y: '(', U: ')', I: '.', O: ',', P: '+', A: ' ', S: '*', D: '/', F: '%', G: '&', H: '|', J: '[', K: ']', L: '_', Z: '~', X: '#', C: ':', V: ';', B: "'", N: '?', M: '@', '-': '-' };
const NUM = { Q: '1', W: '2', E: '3', R: '4', T: '5', Y: '6', U: '7', I: '8', O: '9', P: '0', '-': '-' };
function openOv(o) { OV = { sel: 0, mode: 0, ...o }; dev.setTab(o.id); drawOv(); ov.classList.add('open'); const i = ov.querySelector('.ov-input'); if (i && matchMedia('(pointer:fine)').matches) i.focus(); }
function closeOv() { OV = null; ov.classList.remove('open'); ov.innerHTML = ''; dev.setTab(null); render(); }
function drawOv() {
  if (!OV) return;
  let h = `<div class="ov-title"><span>${esc(OV.title)}</span>${OV.input != null ? `<span class="mode">${MODES[OV.mode]} · INPUT MODE</span>` : ''}</div>`;
  if (OV.input != null) h += `<input class="ov-input" value="${esc(OV.input)}" spellcheck="false" autocomplete="off" autocapitalize="off">`;
  if (OV.err) h += `<div class="ov-err">${esc(OV.err)}</div>`;
  if (OV.hint) h += `<div class="ov-hint">${esc(OV.hint)}</div>`;
  if (OV.raw != null) h += `<div class="ov-raw">${OV.raw}</div>`;
  if (OV.items) h += '<div class="ov-list">' + OV.items.map((it, i) => `<div class="ov-row${i === OV.sel ? ' sel' : ''}" data-i="${i}"><span>${esc(it.label)}</span>${it.v != null ? `<span class="v">${esc(it.v)}</span>` : ''}</div>`).join('') + '</div>';
  ov.innerHTML = h;
  const inp = ov.querySelector('.ov-input');
  if (inp) inp.oninput = () => { OV.input = inp.value; };   // Enter / Escape reach the device's own keyboard mapping (YES / NO)
  for (const r of ov.querySelectorAll('.ov-row')) r.onclick = () => { OV.sel = +r.dataset.i; drawOv(); yes(); };
  const s = ov.querySelector('.ov-row.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
}
function typeKey(ch, physical) {
  if (!OV || OV.input == null) return false;
  if (physical) return true;                                     // the real keyboard types into the focused input itself
  const m = MODES[OV.mode];
  const c = m === '123' ? (NUM[ch] || ch) : m === 'SYM' ? (SYM[ch] || ch) : m === 'abc' ? ch.toLowerCase() : ch;
  OV.input += c; drawOv(); return true;
}

function filterOv() {
  openOv({ id: 'filter', title: 'FILTER', input: T.filter || '', hint: 'lamina\'s language, e.g.  Cu_pct > 1 and LITO = "SULPHIDE"\nYES applies · NO cancels · an empty filter shows every row\nINPUT MODE: abc ABC 123 SYM (SYM: Q> W< E= R! T" Y( U) I. O, P+ A␣)', onYes: applyFilter });
}
async function applyFilter() {
  const str = OV.input.trim();
  if (!str) { T.filter = ''; T.fr = null; T.view = T.base; cur = 0; closeOv(); dev.flash('every row'); return; }
  const v = validate(str, T.schema);
  if (!v.ok) { OV.err = (v.errors[0] && v.errors[0].message) || 'not a filter'; drawOv(); return; }
  let pred; try { pred = compileBool(str, T.schema, { decimal: T.d.decimal }); } catch (e) { OV.err = e.message; drawOv(); return; }
  closeOv();
  busy = new AbortController(); dev.led(true);
  try {
    const fr = await scanFilter(T.src, { predicate: pred, dataStart: T.dataStart, signal: busy.signal, onProgress: (b, n) => progress('FILTERING', n ? b / n : 0) });
    T.filter = str; T.fr = fr; T.view = createResultView(T.src, fr, T.schema); T.view.onReady && T.view.onReady(() => render());
    cur = 0; top = 0; render(); dev.flash(`${fr.nums.length.toLocaleString('en-US')} rows match`);
  } catch (e) { render(); if (!(e && e.name === 'AbortError')) dev.flash('filter: ' + (e.message || e)); }
  finally { busy = null; dev.led(false); }
}
function gotoOv() {
  openOv({ id: 'goto', title: 'GO TO ROW', input: '', mode: 2, hint: `1 … ${T.view.rowCount().toLocaleString('en-US')}${T.fr ? ' (in the filtered rows)' : ''} · YES goes`, onYes: () => {
    const n = parseInt(OV.input.replace(/\D/g, ''), 10); if (!n) { OV.err = 'a row number'; drawOv(); return; }
    cur = n - 1; closeOv();
  } });
}
async function rawOv() {
  const vs = T.view, rec = (vs.rowHeaderAt ? vs.rowHeaderAt(cur) - 1 : cur) + T.dataStart;
  const split = (b) => splitRecordsPos(b, { kind: T.src.kind, quote: (T.src.quote || '"').charCodeAt(0) });
  const off = await recordOffset(T.src, rec, split);
  const bytes = await T.src.readRange(off, Math.min(4096, T.src.totalBytes - off));
  let end = bytes.indexOf(10); if (end < 0) end = bytes.length;
  const crlf = end > 0 && bytes[end - 1] === 13;
  const line = new TextDecoder(T.encoding || 'utf-8', { fatal: false }).decode(bytes.subarray(0, crlf ? end - 1 : end));
  openOv({ id: 'raw', title: `RAW · ROW ${(rec - T.dataStart + 1).toLocaleString('en-US')} · BYTE ${off.toLocaleString('en-US')}`,
    raw: esc(visibleText(line)) + `<span class="eol">${end < bytes.length ? (crlf ? '␍␊' : '␊') : ''}</span>`, hint: '⇥ tab · · trailing space · ⍽ no-break space · ␍␊ / ␊ the line\'s end' });
}
async function statsOv() {
  const s = T.schema[col], numeric = s.type === 'number';
  busy = new AbortController(); dev.led(true);
  try {
    const st = await scanColumnStats(T.src, { col, dataStart: T.dataStart, numeric, decimal: T.d.decimal, rows: T.fr ? T.fr.nums : null, signal: busy.signal, onProgress: (b, n) => progress('COUNTING', n ? b / n : 0) });
    const it = numeric
      ? [['rows', st.count], ['blank', st.nulls], ['not a number', st.bad], ['min', st.min], ['p50', st.quantiles && st.quantiles.p50], ['mean', st.mean], ['max', st.max], ['std', st.std]]
      : [['rows', st.count], ['blank', st.nulls], ['distinct', st.distinct], ...st.top.slice(0, 8).map((t) => [`= ${t.value}`, t.n])];
    render();
    openOv({ id: 'stats', title: `STATS · ${s.name}${T.fr ? ' · FILTERED' : ''}`, items: it.map(([label, v]) => ({ label, v: fmt(v) })) });
  } catch (e) { render(); if (!(e && e.name === 'AbortError')) dev.flash('stats: ' + (e.message || e)); }
  finally { busy = null; dev.led(false); }
}
function menuOv() {
  const items = [{ label: 'OPEN FILE…', act: () => { closeOv(); pickFile(); } }, { label: 'OPEN SAMPLE', v: '120,000 rows', act: () => { closeOv(); openSample(); } }];
  if (T) {
    items.push({ label: 'ENCODING', v: T.encoding || 'utf-8', act: () => { const next = (T.encoding || 'utf-8') === 'utf-8' ? 'windows-1252' : 'utf-8'; const f = T.file; closeOv(); openFile(f, next === 'utf-8' ? undefined : next); } });
    items.push({ label: 'BOOKMARKS', v: String(T.marks.size), act: () => {
      const m = [...T.marks].sort((a, b) => a - b);
      openOv({ id: 'menu', title: 'BOOKMARKS', items: m.length ? m.map((rec) => ({ label: `row ${rec.toLocaleString('en-US')}`, act: () => { goRecord(rec); closeOv(); } })) : [{ label: 'none yet — B-MARK marks a row' }] });
    } });
  }
  items.push({ label: 'THE FULL LAMINA ↗', act: () => { location.href = '../'; } });
  items.push({ label: 'ABOUT', act: () => openOv({ id: 'menu', title: 'ABOUT', raw: 'lamina, DD-60 edition — a GCU DADA Diskman that never was, reading files of any size the way lamina does: one streamed pass builds an index, rows are read in windows, the file is never held whole. Networkless: nothing you open leaves this page.\n\ngentropic.org/lamina', items: null }) });
  openOv({ id: 'menu', title: 'MENU', items });
}
function goRecord(rec) {                                      // a bookmark (1-based display row) → its row in the view
  const vs = T.view;
  if (!vs.rowHeaderAt) { cur = rec - 1; return; }
  for (let r = 0, n = vs.rowCount(); r < n; r++) if (vs.rowHeaderAt(r) === rec) { cur = r; return; }
  dev.flash('filtered out');
}
function yes() {
  if (!OV) { if (T) recordOv(); return; }
  if (OV.items && OV.items[OV.sel] && OV.items[OV.sel].act) return OV.items[OV.sel].act();
  if (OV.onYes) return OV.onYes();
  closeOv();
}
function recordOv() {                                          // YES on a row: every field of it
  const vs = T.view, row = vs.rowAt(cur); if (!row || row === LOADING) return;
  openOv({ id: 'menu', title: `ROW ${(vs.rowHeaderAt ? vs.rowHeaderAt(cur) : cur + 1).toLocaleString('en-US')}`, items: T.schema.map((s, k) => ({ label: s.name, v: row[k] == null || row[k] === '' ? '(blank)' : row[k] })) });
}

// ── the device's buttons ────────────────────────────────────────────────────────────────────────────────
dev.on((e) => {
  if (e.type === 'no') { if (busy) { busy.abort(); return; } if (OV) closeOv(); return; }
  if (e.type === 'yes') return yes();
  if (e.type === 'input') { if (OV && OV.input != null) { OV.mode = (OV.mode + 1) % MODES.length; drawOv(); } return; }
  if (e.type === 'shift') { if (OV && OV.input != null) { OV.mode = OV.mode === 0 ? 1 : 0; drawOv(); } return; }
  if (e.type === 'key') {
    if (typeKey(e.ch.toUpperCase() === e.ch && e.ch.length === 1 && /[A-Z]/i.test(e.ch) ? e.ch.toUpperCase() : e.ch, e.physical)) return;
    if (!OV && T && e.physical && /^[0-9]$/.test(e.ch)) { gotoOv(); OV.input = e.ch; drawOv(); }
    return;
  }
  if (e.type === 'bmark') { if (!T || OV) return; const rec = T.view.rowHeaderAt ? T.view.rowHeaderAt(cur) : cur + 1; if (T.marks.has(rec)) T.marks.delete(rec); else T.marks.add(rec); dev.flash(T.marks.has(rec) ? 'bookmarked' : 'unmarked'); render(); return; }
  if (e.type === 'f') {
    if (OV && OV.id === e.id) { closeOv(); return; }
    if (e.id === 'menu') return menuOv();
    if (!T) { dev.flash('no disc — MENU → OPEN FILE'); return; }
    return ({ filter: filterOv, goto: gotoOv, raw: rawOv, stats: statsOv })[e.id]();
  }
  if (e.type === 'dpad') {
    if (OV) {
      if (OV.items && (e.dir === 'up' || e.dir === 'down')) { OV.sel = Math.max(0, Math.min(OV.items.length - 1, OV.sel + (e.dir === 'up' ? -1 : 1))); drawOv(); }
      return;
    }
    if (!T) return;
    const step = e.repeat ? 1 : 1;
    if (e.dir === 'up') cur -= step; else if (e.dir === 'down') cur += step;
    else if (e.dir === 'left') col -= 1; else col += 1;
    render();
  }
});

// ── a file in ────────────────────────────────────────────────────────────────────────────────────────────
const pick = document.getElementById('pick');
function pickFile() { pick.value = ''; pick.click(); }
pick.onchange = () => { if (pick.files[0]) openFile(pick.files[0]); };
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('dragging'); });
addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('dragging'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) openFile(f); });
// wheel / swipe on the LCD scrolls the rows
screen.addEventListener('wheel', (e) => { if (!T || OV) return; e.preventDefault(); cur += Math.sign(e.deltaY) * 3; render(); }, { passive: false });
let ty = null;
screen.addEventListener('touchstart', (e) => { ty = e.touches[0].clientY; }, { passive: true });
screen.addEventListener('touchmove', (e) => { if (!T || OV || ty == null) return; const dy = ty - e.touches[0].clientY; if (Math.abs(dy) > 14) { cur += Math.round(dy / 14); ty = e.touches[0].clientY; render(); } e.preventDefault(); }, { passive: false });

// the sample: lamina's own synthetic block model, generated in the page (no fetch)
function openSample() {
  let s = 987654321;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff, s / 0x7fffffff);
  const randn = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const nx = 60, ny = 50, nz = 40, x0 = 620000, y0 = 7780000, z0 = 400, cx = nx / 2, cy = ny / 2, cz = nz * 0.45;
  const rows = ['ID,X,Y,Z,dx,dy,dz,Au_gpt,Cu_pct,Ag_gpt,Fe_pct,density,ore_pct,recovery,LITO,ZONE']; let id = 1;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const dxi = (i - cx) / nx, dyj = (j - cy) / ny, dzk = (k - cz) / nz;
    const ore = Math.exp(-(dxi * dxi * 4 + dyj * dyj * 4 + dzk * dzk * 6) * 3);
    const cu = Math.max(0, ore * 1.8 * Math.exp(0.5 * randn()) - 0.02), au = Math.max(0, ore * 1.2 * Math.exp(0.6 * randn()) - 0.01);
    const ag = Math.max(0, cu * 8 * Math.exp(0.4 * randn())), fe = Math.max(1, 8 + ore * 12 + 2 * randn());
    const dens = 2.55 + ore * 0.35 + 0.03 * randn(), rec = Math.min(98, Math.max(60, 78 + ore * 14 + 2 * randn()));
    const orep = Math.min(1, Math.max(0, ore * 1.2)), depth = k / nz;
    const lito = (cu < 0.05 && au < 0.05) ? 'WASTE' : depth < 0.25 ? 'OXIDE' : depth < 0.45 ? 'TRANSITION' : 'SULPHIDE';
    rows.push([id++, x0 + i * 10, y0 + j * 10, z0 + k * 5, 10, 10, 5, au.toFixed(3), cu.toFixed(3), ag.toFixed(2), fe.toFixed(2), dens.toFixed(3), orep.toFixed(3), rec.toFixed(1), lito, 'Z' + (1 + Math.min(4, Math.floor(depth * 5)))].join(','));
  }
  const bytes = new TextEncoder().encode(rows.join('\n'));
  const f = new File([bytes], 'sample_blockmodel.csv'); f._sampleBytes = bytes;
  return openFile(f).then(() => { if (T && T.name === 'sample_blockmodel.csv') { cur = 55690; col = 8; render(); } });   // where the book's cover shows it: rows 55,691…, on Cu_pct
}

empty();
window._dd60 = { dev, openFile, openSample, get T() { return T; }, get cur() { return cur; }, get col() { return col; }, get OV() { return OV; }, render };
