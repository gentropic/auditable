// micro block-model QA — the model's report before anyone reports from it, the
// twin of drillhole QA and mesh QA. One pass over the records:
//   the LATTICE — two blocks in one cell, a centroid off the grid, a gap inside a
//   column (missing blocks between a column's lowest and highest block);
//   every COLUMN — blanks, sentinel values (−99, −999, −1e30…), negatives, zeros,
//   a constant or empty column, a density outside what rock weighs, and a maximum
//   far above the 99.9th percentile (a top-cut question).
// A finding that names records selects them on click; a gap (records that AREN'T
// there) steps the camera through examples. Nothing here changes the model.
import { attrRowCountOf, colIsNumeric, layerRecords, layerTableHeader, numOf } from './records.js';
import { floatWin, focusWindow } from './windows.js';
import { fmtStat } from './analysis-ui.js';
import { zoomToPoint } from './camera.js';
import { applyLayerSelection } from './selection.js';
import { deliverBlob } from './hostio.js';
import { S, requestRender } from './state.js';
const $ = (s) => document.querySelector(s);
export const _modelQaWins = new Map();

const SENTINELS = [-99, -999, -9999, -99999, -999999, -1e30, 1e30, -1e20, 1e20, -1e10];
const isSentinel = (v) => SENTINELS.some((s) => v === s || (Math.abs(s) >= 1e10 && Math.abs(v - s) <= Math.abs(s) * 1e-6));
export const DENSITY_RE = /^(dens(ity)?|sg|bd|bulk_?dens(ity)?|rho|dry_?dens(ity)?|spg)$/i;
const SEV = { error: 'var(--fault)', warn: 'var(--caution)', info: 'var(--info)', ok: 'var(--ok)' };
const RESERVOIR = 50000;

// ── the scan (pure over a layer; the window renders its result) ────────────────
export async function modelQa(L, { onProgress = null, signal = null, keepRecords = 200000 } = {}) {
  const h = layerTableHeader(L);
  const bd = L.docs && L.docs.blockDoc;
  if (!h || !bd) throw new Error('model QA needs a block model');
  const nFile = (bd.header.columns || h.columns).length;
  const cols = h.columns.slice(0, nFile);
  const m = h.mapping || {};
  const g = bd.header.grid || null;
  const sub = !!bd.header.subBlocked;
  const rot = !!(g && g.rot);
  const lattice = g && !rot && !sub && g.x.pitch > 0 && g.y.pitch > 0 && g.z.pitch > 0;
  const nx = lattice ? g.x.count : 0, ny = lattice ? g.y.count : 0, nz = lattice ? g.z.count : 0;
  const cells = nx * ny * nz;
  // occupancy: one bit a cell while that fits, a Set otherwise
  const bits = lattice && cells <= 2 ** 30 ? new Uint32Array(Math.ceil(cells / 32)) : null;
  const seen = lattice && !bits ? new Set() : null;
  const colN = lattice ? nx * ny : 0;
  const kMin = lattice ? new Int32Array(colN).fill(2 ** 30) : null, kMax = lattice ? new Int32Array(colN).fill(-1) : null, kCnt = lattice ? new Int32Array(colN) : null;
  const dupRecs = [], offRecs = [];
  let dups = 0, off = 0;
  const numeric = cols.map((_, i) => colIsNumeric(L, h, i));
  const C = cols.map((name, i) => ({
    name, i, numeric: numeric[i], role: i === m.x ? 'x' : i === m.y ? 'y' : i === m.z ? 'z' : null,
    n: 0, blank: 0, sentinel: 0, negative: 0, zero: 0, nonNum: 0, min: Infinity, max: -Infinity, sum: 0, res: [], seenN: 0,
    distinct: new Set(), density: DENSITY_RE.test(String(name).trim()), densLow: 0, densHigh: 0,
  }));
  let N = 0, lastP = 0;
  for await (const { f, rec } of layerRecords(L)) {
    if (signal && signal.aborted) throw new Error('cancelled');
    N++;
    for (const c of C) {
      const raw = f[c.i];
      const blank = raw == null || (typeof raw === 'string' && raw.trim() === '');
      if (blank) { c.blank++; continue; }
      c.n++;
      if (!c.numeric) { if (c.distinct.size <= 1000) c.distinct.add(String(raw)); continue; }
      const v = numOf(raw);
      if (!Number.isFinite(v)) { c.nonNum++; continue; }
      if (isSentinel(v)) { c.sentinel++; continue; }
      if (v < c.min) c.min = v;
      if (v > c.max) c.max = v;
      c.sum += v;
      if (v < 0) c.negative++;
      else if (v === 0) c.zero++;
      if (c.density && v !== 0 && (v < 1 || v > 6)) { if (v < 1) c.densLow++; else c.densHigh++; }   // a zero has its own finding
      if (c.res.length < RESERVOIR) c.res.push(v);
      else { const j = Math.floor(Math.random() * (c.seenN + 1)); if (j < RESERVOIR) c.res[j] = v; }
      c.seenN++;
    }
    if (lattice) {
      const x = numOf(f[m.x]), y = numOf(f[m.y]), z = numOf(f[m.z]);
      const fi = (x - g.x.origin) / g.x.pitch, fj = (y - g.y.origin) / g.y.pitch, fk = (z - g.z.origin) / g.z.pitch;
      const i = Math.round(fi), j = Math.round(fj), k = Math.round(fk);
      if (Math.abs(fi - i) > 1e-3 || Math.abs(fj - j) > 1e-3 || Math.abs(fk - k) > 1e-3 || i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
        off++; if (offRecs.length < keepRecords) offRecs.push(rec);
      } else {
        const key = i + nx * (j + ny * k);
        let was;
        if (bits) { const w = key >>> 5, b = 1 << (key & 31); was = (bits[w] & b) !== 0; bits[w] |= b; }
        else { was = seen.has(key); seen.add(key); }
        if (was) { dups++; if (dupRecs.length < keepRecords) dupRecs.push(rec); }
        else { const cc = i + nx * j; if (k < kMin[cc]) kMin[cc] = k; if (k > kMax[cc]) kMax[cc] = k; kCnt[cc]++; }
      }
    }
    if (onProgress && N - lastP >= 50000) { lastP = N; onProgress(N); await new Promise((r) => setTimeout(r, 0)); }
  }
  // gaps: a column's span minus what it holds
  let gapCells = 0, gapCols = 0;
  const gapAt = [];
  if (lattice) {
    for (let cc = 0; cc < colN; cc++) {
      if (kMax[cc] < 0) continue;
      const gap = kMax[cc] - kMin[cc] + 1 - kCnt[cc];
      if (gap > 0) {
        gapCells += gap; gapCols++;
        if (gapAt.length < 200) {
          const i = cc % nx, j = (cc / nx) | 0;
          gapAt.push([g.x.origin + i * g.x.pitch, g.y.origin + j * g.y.pitch, g.z.origin + ((kMin[cc] + kMax[cc]) / 2) * g.z.pitch]);
        }
      }
    }
  }
  for (const c of C) {
    if (!c.numeric || !c.res.length) continue;
    const s = Float64Array.from(c.res).sort();
    const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    c.p999 = q(0.999); c.p50 = q(0.5);
    c.mean = c.n - c.nonNum - c.sentinel > 0 ? c.sum / (c.n - c.nonNum - c.sentinel) : null;
    c.res = null;
  }
  return { N, cols: C, lattice: lattice ? { nx, ny, nz, cells, dups, off, gapCells, gapCols, gapAt, dupRecs, offRecs } : null,
    why: !g ? 'points (no block grid)' : rot ? 'a rotated lattice' : sub ? 'sub-blocked (variable sizes)' : null, count: attrRowCountOf(L) };
}

// the findings a reviewer reads, worst first; each knows how to show itself
export function qaFindings(r) {
  const out = [];
  const add = (sev, check, column, count, show, note = '') => out.push({ sev, check, column, count, show, note });
  const lt = r.lattice;
  if (lt) {
    if (lt.dups) add('error', 'two blocks in one cell', '', lt.dups, { recs: lt.dupRecs }, 'the later block of each pair');
    if (lt.off) add('error', 'centroid off the grid', '', lt.off, { recs: lt.offRecs });
    if (lt.gapCells) add('warn', 'gap inside a column', '', lt.gapCells, { at: lt.gapAt }, `${lt.gapCols.toLocaleString()} column${lt.gapCols > 1 ? 's' : ''} — missing blocks between a column's lowest and highest`);
  }
  for (const c of r.cols) {
    const pred = (kind) => ({ col: c.i, kind });
    if (c.n === 0) { add('warn', 'empty column', c.name, r.N, null, 'every value blank'); continue; }
    if (c.role && c.blank) add('error', 'blank coordinate', c.name, c.blank, { pred: pred('blank') });
    else if (c.blank) add('info', 'blank values', c.name, c.blank, { pred: pred('blank') });
    if (!c.numeric) continue;
    if (c.sentinel) add('warn', 'sentinel values (−99, −999, −1e30…)', c.name, c.sentinel, { pred: pred('sentinel') }, 'a missing-value code read as a number would bias every mean');
    if (c.nonNum) add('warn', 'text in a numeric column', c.name, c.nonNum, { pred: pred('nonNum') });
    if (c.density && (c.densLow || c.densHigh)) add('error', 'density outside 1–6 t/m³', c.name, c.densLow + c.densHigh, { pred: pred('density') }, `${c.densLow} below 1 · ${c.densHigh} above 6`);
    if (c.density && c.zero) add('error', 'zero density', c.name, c.zero, { pred: pred('zero') }, 'a block of no tonnage');
    if (c.negative && !c.role) add('warn', 'negative values', c.name, c.negative, { pred: pred('negative') });
    if (c.min === c.max && Number.isFinite(c.min)) add('info', 'constant column', c.name, r.N, null, `every value ${fmtStat(c.min)}`);
    if (!c.role && c.p999 > 0 && c.max > 10 * c.p999) add('warn', 'maximum far above the 99.9th percentile', c.name, 1, { pred: { col: c.i, kind: 'above', v: 10 * c.p999 } }, `max ${fmtStat(c.max)} = ${(c.max / c.p999).toFixed(0)}× the 99.9th percentile ${fmtStat(c.p999)} — a top-cut question`);
  }
  const rank = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev] || b.count - a.count);
}

const matches = (p, f) => {
  const raw = f[p.col];
  const blank = raw == null || (typeof raw === 'string' && raw.trim() === '');
  if (p.kind === 'blank') return blank;
  if (blank) return false;
  const v = numOf(raw);
  if (p.kind === 'nonNum') return !Number.isFinite(v);
  if (!Number.isFinite(v)) return false;
  if (p.kind === 'sentinel') return isSentinel(v);
  if (isSentinel(v)) return false;
  if (p.kind === 'negative') return v < 0;
  if (p.kind === 'zero') return v === 0;
  if (p.kind === 'density') return v !== 0 && (v < 1 || v > 6);
  if (p.kind === 'above') return v > p.v;
  return false;
};

/** Select a finding's records on the layer. Resolves to how many. */
export async function selectFinding(L, fd) {
  const n = attrRowCountOf(L); if (!n || !fd.show) return 0;
  const mask = new Uint8Array(n);
  if (fd.show.recs) for (const r of fd.show.recs) mask[r] = 1;
  else if (fd.show.pred) for await (const { f, rec } of layerRecords(L)) { if (matches(fd.show.pred, f)) mask[rec] = 1; }
  else return 0;
  L._selMask = mask;
  applyLayerSelection(L);
  requestRender();
  return L._selCount || mask.reduce((a, b) => a + b, 0);
}

export async function openModelQa(L) {
  if (!L || !L.docs || !L.docs.blockDoc) { $('#meta').textContent = 'model QA: needs a block model'; return null; }
  const ex = _modelQaWins.get(L.id); if (ex && ex.win.el.isConnected) { focusWindow(ex.win.el); return ex; }
  const st = { r: null, err: null, step: new Map(), ctl: new AbortController() };
  const win = floatWin({ title: `model QA · ${L.label || L.name}`, sub: 'checking…', x: Math.max(12, innerWidth - 780), y: 100, w: 740, h: 460,
    onClose: () => { st.ctl.abort(); _modelQaWins.delete(L.id); } });
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main st-main';
  body.append(rail, main);
  const entry = { win, st, render: null, done: null };
  _modelQaWins.set(L.id, entry);
  const cell = (tr, text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.append(td); return td; };
  const line = (k, v, color) => { const d = document.createElement('div'); d.className = 'sw-row'; const a = document.createElement('span'); a.textContent = k; a.style.width = '74px'; const b = document.createElement('b'); b.textContent = v; if (color) b.style.color = color; d.append(a, b); rail.append(d); };
  const render = () => {
    rail.textContent = ''; main.textContent = '';
    if (st.err) { const d = document.createElement('div'); d.className = 'st-empty'; d.textContent = st.err; main.append(d); win.sub.textContent = 'model QA'; return; }
    const r = st.r; if (!r) { const d = document.createElement('div'); d.className = 'st-empty'; d.textContent = 'checking…'; main.append(d); return; }
    const fs = qaFindings(r);
    const errs = fs.filter((f) => f.sev === 'error').length, warns = fs.filter((f) => f.sev === 'warn').length;
    win.sub.textContent = errs ? `${errs} error${errs > 1 ? 's' : ''}` : warns ? `${warns} to look at` : 'clean';
    rail.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'model' }));
    line('blocks', r.N.toLocaleString());
    line('columns', String(r.cols.length));
    if (r.lattice) { line('grid', `${r.lattice.nx}×${r.lattice.ny}×${r.lattice.nz}`); line('filled', `${(100 * (r.N - r.lattice.dups - r.lattice.off) / r.lattice.cells).toFixed(1)}% of cells`); }
    else line('lattice', `not checked — ${r.why}`, SEV.info);
    line('verdict', errs ? '✗ errors' : warns ? '! warnings' : '✓ clean', errs ? SEV.error : warns ? SEV.warn : SEV.ok);
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    const tsv = document.createElement('button'); tsv.className = 'awin-btn'; tsv.textContent = 'export .tsv'; tsv.title = 'the findings and the column census, as a table';
    tsv.onclick = () => {
      const lines = [`# micro model QA · ${L.label || L.name} · ${r.N} blocks · ${new Date().toISOString()}`, ['severity', 'check', 'column', 'count', 'note'].join('\t'),
        ...fs.map((f) => [f.sev, f.check, f.column, f.count, f.note].join('\t')), '', ['column', 'type', 'values', 'blank', 'min', 'max', 'mean', 'p99.9', 'sentinels', 'negatives', 'zeros'].join('\t'),
        ...r.cols.map((c) => [c.name, c.numeric ? 'number' : 'text', c.n, c.blank, c.numeric ? c.min : '', c.numeric ? c.max : '', c.mean ?? '', c.p999 ?? '', c.sentinel, c.negative, c.zero].join('\t'))];
      const nm = `${(L.label || L.name).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-')}-qa.tsv`;
      deliverBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/tab-separated-values' }), nm);
      $('#meta').textContent = `model QA saved as ${nm}`;
    };
    foot.append(tsv); rail.append(foot);
    // findings
    if (!fs.length) { const d = document.createElement('div'); d.className = 'qa-clean'; d.textContent = '✓ nothing to report'; main.append(d); }
    else {
      const t = document.createElement('table'); t.className = 'st-tbl mq-tbl';
      const hr = document.createElement('tr'); for (const x of ['', 'check', 'column', 'count', '']) { const th = document.createElement('th'); th.textContent = x; hr.append(th); } t.append(hr);
      for (const f of fs) {
        const tr = document.createElement('tr');
        const dot = cell(tr, '●'); dot.style.color = SEV[f.sev];
        const c1 = cell(tr, f.check); if (f.note) c1.title = f.note;
        cell(tr, f.column); cell(tr, f.count.toLocaleString(), 'num');
        const act = cell(tr, f.show ? (f.show.at ? 'go to' : 'select') : '');
        if (f.show) {
          tr.style.cursor = 'pointer';
          tr.title = (f.note ? f.note + ' · ' : '') + (f.show.at ? 'click: the camera goes to the next one' : 'click: select these blocks');
          tr.onclick = async () => {
            if (f.show.at) {
              const i = (st.step.get(f.check) ?? -1) + 1; st.step.set(f.check, i);
              const at = f.show.at[i % f.show.at.length];
              zoomToPoint(at, 3 * Math.max(r.lattice ? 1 : 0, 10), 10);
              act.textContent = `${(i % f.show.at.length) + 1} / ${f.show.at.length}${f.count > f.show.at.length ? '+' : ''}`;
            } else {
              act.textContent = '…';
              const n = await selectFinding(L, f);
              act.textContent = `${n.toLocaleString()} selected`;
              $('#meta').textContent = `model QA: ${n.toLocaleString()} block${n === 1 ? '' : 's'} selected — ${f.check}${f.column ? ` (${f.column})` : ''}`;
            }
          };
        }
        t.append(tr);
      }
      main.append(t);
    }
    // the column census
    const h2 = document.createElement('div'); h2.className = 'sw-h'; h2.textContent = 'columns'; h2.style.marginTop = '10px'; main.append(h2);
    const ct = document.createElement('table'); ct.className = 'st-tbl';
    const ch = document.createElement('tr'); for (const x of ['column', 'values', 'blank', 'min', 'p50', 'p99.9', 'max', 'mean']) { const th = document.createElement('th'); th.textContent = x; ch.append(th); } ct.append(ch);
    for (const c of r.cols) {
      const tr = document.createElement('tr');
      cell(tr, c.name + (c.role ? ` (${c.role})` : '') + (c.density ? ' (density)' : ''));
      cell(tr, c.n.toLocaleString(), 'num'); cell(tr, c.blank ? c.blank.toLocaleString() : '', 'num');
      if (c.numeric && Number.isFinite(c.min)) for (const v of [c.min, c.p50, c.p999, c.max, c.mean]) cell(tr, v == null ? '' : fmtStat(v), 'num');
      else { cell(tr, c.numeric ? '' : `${c.distinct.size > 1000 ? '1000+' : c.distinct.size} distinct`); for (let k = 0; k < 4; k++) cell(tr, ''); }
      ct.append(tr);
    }
    main.append(ct);
  };
  entry.render = render;
  render();
  entry.done = (async () => {
    try { st.r = await modelQa(L, { signal: st.ctl.signal, onProgress: (n) => { win.sub.textContent = `checking… ${n.toLocaleString()} blocks`; } }); }
    catch (e) { st.err = e.message === 'cancelled' ? null : `model QA: ${e.message}`; }
    if (win.el.isConnected) render();
    return st.r;
  })();
  return entry;
}
