// micro block-model QA — the model's report before anyone reports from it, the
// twin of drillhole QA and mesh QA. One pass over the records:
//   the LATTICE — two blocks in one cell, a centroid off the grid, a gap inside a
//   column (missing blocks between a column's lowest and highest block);
//   every COLUMN — blanks, sentinel values (−99, −999, −1e30…), negatives, zeros,
//   a constant or empty column, a density outside what rock weighs, and a maximum
//   far above the 99.9th percentile (a top-cut question).
// A finding that names records selects them on click; a gap (records that AREN'T
// there) steps the camera through examples. Nothing here changes the model.
//   SUB-BLOCKS (a sub-blocked model) — do they tile their parents: a parent's
//   sub-blocks summing to less than the parent (a gap) or more (an overlap — the
//   blocks claiming one fine cell twice are named), a block reaching out of its
//   parent, a size off the parent's sub-lattice, a Datamine IJK that disagrees with
//   the block's position. Columnar and streamed parent by parent (condenser
//   grid/tiling.js) — never a whole-model fine grid.
import { attrRowCountOf, colIsNumeric, layerRecords, layerTableHeader, numOf, dmDocReader } from './records.js';
import { floatWin, focusWindow } from './windows.js';
import { fmtStat } from './analysis-ui.js';
import { zoomToPoint } from './camera.js';
import { applyLayerSelection } from './selection.js';
import { deliverBlob } from './hostio.js';
import { S, requestRender } from './state.js';
import { supportOfHeader, supportToLattice, supportToWorld, tilingChecker } from '../../../ext/condenser/src/main.js';
import { canScanColumnar, scanColumnar } from './colscan.js';
import { docPositionStream } from './records.js';
import { registerCommands } from './commands.js';
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
  // the block-support contract: a regular lattice is checked cell by cell in its OWN frame
  // (a rotated model's world rows carried into it); a sub-blocked one has no cell per block
  const g = bd.header.grid || null, sup = supportOfHeader(bd.header);
  const sub = !!(sup && sup.sub);
  const rot = !!(sup && sup.frame.rotated);
  const lattice = !!sup && !sub && g.x.pitch > 0 && g.y.pitch > 0 && g.z.pitch > 0;
  const qb = [0, 0, 0];
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
  const seeCol = (c, raw) => {
    const blank = raw == null || (typeof raw === 'string' && raw.trim() === '');
    if (blank) { c.blank++; return; }
    c.n++;
    if (!c.numeric) { if (c.distinct.size <= 1000) c.distinct.add(String(raw)); return; }
    const v = numOf(raw);
    if (!Number.isFinite(v)) { c.nonNum++; return; }
    if (isSentinel(v)) { c.sentinel++; return; }
    if (v < c.min) c.min = v;
    if (v > c.max) c.max = v;
    c.sum += v;
    if (v < 0) c.negative++;
    else if (v === 0) c.zero++;
    if (c.density && v !== 0 && (v < 1 || v > 6)) { if (v < 1) c.densLow++; else c.densHigh++; }   // a zero has its own finding
    if (c.res.length < RESERVOIR) c.res.push(v);
    else { const j = Math.floor(Math.random() * (c.seenN + 1)); if (j < RESERVOIR) c.res[j] = v; }
    c.seenN++;
  };
  // a .dm's file columns are read COLUMNAR (strided, typed — no row arrays: the census of an
  // 18.7M-block model in a fraction of the row path's time); every other source row by row
  const dmCols = bd.header.dm ? await dmDocReader(bd) : null;
  const seeLattice = (x, y, z, rec) => {
    {
      if (rot) { supportToLattice(sup.frame, x, y, z, qb); x = qb[0]; y = qb[1]; z = qb[2]; }
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
  };
  const tick = async () => { lastP = N; onProgress(N); await new Promise((r) => setTimeout(r, 0)); };
  if (dmCols) {
    // a DD constant is one value for every record: seen once, counted N times (below)
    const dmc = bd.header.dm.columns, isConst = (i) => !!(dmc[i] && dmc[i].isConstant);
    const varC = C.filter((c) => !isConst(c.i)), constC = C.filter((c) => isConst(c.i));
    const ids = [...new Set([...varC.map((c) => c.i), ...(lattice ? [m.x, m.y, m.z] : [])])];
    const cell = (v) => (typeof v === 'number' && v !== v ? null : v);
    for await (const { recStart, count, cols } of dmCols.columnBatches(ids, { signal })) {
      if (signal && signal.aborted) throw new Error('cancelled');
      for (const c of varC) { const a = cols[c.i]; for (let k = 0; k < count; k++) seeCol(c, cell(a[k])); }
      if (lattice) { const X = cols[m.x], Y = cols[m.y], Z = cols[m.z]; for (let k = 0; k < count; k++) seeLattice(numOf(cell(X[k])), numOf(cell(Y[k])), numOf(cell(Z[k])), recStart + k); }
      N += count;
      if (onProgress && N - lastP >= 50000) await tick();
    }
    for (const c of constC) {
      seeCol(c, cell(dmc[c.i].constantValue));
      for (const k of ['n', 'blank', 'sentinel', 'negative', 'zero', 'nonNum', 'densLow', 'densHigh']) c[k] *= N;
      c.sum *= N; c.seenN *= N;
    }
  } else {
    for await (const { f, rec } of layerRecords(L)) {
      if (signal && signal.aborted) throw new Error('cancelled');
      N++;
      for (const c of C) seeCol(c, f[c.i]);
      if (lattice) seeLattice(numOf(f[m.x]), numOf(f[m.y]), numOf(f[m.z]), rec);
      if (onProgress && N - lastP >= 50000) await tick();
    }
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
          const q = [g.x.origin + i * g.x.pitch, g.y.origin + j * g.y.pitch, g.z.origin + ((kMin[cc] + kMax[cc]) / 2) * g.z.pitch];
          gapAt.push(rot ? supportToWorld(sup.frame, q[0], q[1], q[2]) : q);
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
  // a sub-blocked model: do its blocks tile their parents (a pass of its own — columnar)
  let tiling = null;
  if (sub) {
    try { tiling = await subBlockTiling(L, { signal, keepRecords, onProgress: onProgress ? (n) => onProgress(n, 'sub-blocks') : null }); }
    catch (e) { if (e.message === 'cancelled') throw e; tiling = { why: e.message }; }
  }
  return { N, cols: C, lattice: lattice ? { nx, ny, nz, cells, dups, off, gapCells, gapCols, gapAt, dupRecs, offRecs } : null,
    why: !sup ? 'points (no block grid)' : sub ? 'sub-blocked (variable sizes — no one cell per block)' : null, rotated: rot, count: attrRowCountOf(L), tiling };
}

// ── sub-blocks: do they tile their parents? ───────────────────────────────────
// The parent lattice: a parent is the largest sub-block (header sizeQMax — fine steps),
// its corner a Datamine model's XMORIG/YMORIG/ZMORIG (its local frame) or else found
// from a block spanning a whole parent. The positions come COLUMNAR (@gcu/scan's
// positions kernel on the worker pool, sizes as dimQ — the renderer's rounding), in
// record order, so a parent's blocks arrive together and the checker keeps a handful
// of parents open at a time (condenser grid/tiling.js). → the checker's result + `why`
// when it can't run, + `ms`.
export async function subBlockTiling(L, { signal = null, onProgress = null, keepRecords = 200000 } = {}) {
  const bd = L && L.docs && L.docs.blockDoc, h = bd && bd.header;
  const sup = h ? supportOfHeader(h) : null;
  if (!sup || !sup.sub) return { why: 'not a sub-blocked model' };
  const qm = h.sizeQMax || sup.sizeQMax;
  if (!qm || !(qm[0] >= 1)) return { why: 'the sub-block sizes are unknown (no largest size)' };
  const t0 = performance.now();
  // the parent corner: a Datamine DD states it in the model's own frame (the lattice frame of a placed model)
  const dmc = h.dm && h.dm.columns, cv = (n) => { const c = dmc && dmc.find((x) => x.name === n); return c && c.isConstant && Number.isFinite(c.constantValue) ? c.constantValue : null; };
  const mor = ['XMORIG', 'YMORIG', 'ZMORIG'].map(cv);
  const phase = mor.every((v) => v != null) ? mor : null;
  // a Datamine IJK: (I·NY + J)·NZ + K over the parents counted from that corner
  const nxyz = ['NX', 'NY', 'NZ'].map(cv);
  const ijkIdx = dmc ? dmc.findIndex((c) => c.name === 'IJK' && !c.isConstant) : -1;
  const ijk = phase && ijkIdx >= 0 && nxyz.every((v) => v >= 1) ? { nx: Math.round(nxyz[0]), ny: Math.round(nxyz[1]), nz: Math.round(nxyz[2]) } : null;
  // the occupancy cell: 2 fine steps when the pitch is half the sizes' GCD (an inferred
  // lattice — every valid corner lands on it), 1 for a pitch someone declared
  const declared = h.lattice && h.lattice.basis === 'declared' && h.lattice.by !== 'datamine';
  const chk = tilingChecker(sup, { parentSize: qm, phase, unit: declared ? [1, 1, 1] : [2, 2, 2], ijk, keep: keepRecords });
  let done = 0, lastP = 0, addMs = 0;
  const feed = (ch) => {
    const ta = performance.now(); chk.add(ch); addMs += performance.now() - ta; done += ch.count;
    if (onProgress && done - lastP >= 500000) { lastP = done; onProgress(done); }
  };
  const tl = h.columns, dc = h.dimCols;
  if (!dc || dc.x < 0) return { why: 'the sub-block size columns are unknown' };
  if (canScanColumnar(L)) {
    const P = bd.parquet, m = h.mapping;
    const coords = P ? P.coordNames : [tl[m.x], tl[m.y], tl[m.z]];
    const sizes = [tl[dc.x], tl[dc.y], tl[dc.z]];
    const extra = ijk ? ['IJK'] : [];
    await scanColumnar(L, { kernel: 'positions', params: { coords, sizes, pitch: sup.lattice.pitch, extra }, exprs: [], extraCols: [...coords, ...sizes, ...extra], signal,
      onPart: (g, part, start) => {
        if (signal && signal.aborted) return;
        const recs = new Uint32Array(part.rec.length);
        for (let i = 0; i < recs.length; i++) recs[i] = start + part.rec[i];
        feed({ x: part.x, y: part.y, z: part.z, dimQ: part.dimQ, recs, count: recs.length, ijk: part.ex ? part.ex[0] : null });
      } });
  } else {
    const stream = await docPositionStream(L.docs);
    if (!stream) return { why: 'no position stream for this model' };
    for await (const c of stream({ chunkPoints: 1 << 18, signal })) {
      if (!c.dimQ) return { why: 'the stream carried no block sizes' };
      feed({ x: c.x, y: c.y, z: c.z, dimQ: c.dimQ, recs: c.recIdx || null, base: c.recStart || 0, count: c.count });
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (signal && signal.aborted) throw new Error('cancelled');
  const r = chk.finish();
  r.ms = performance.now() - t0; r.checkMs = addMs;          // the whole pass · the checker's own share (the rest is reading)
  r.ijkChecked = !!ijk;
  return r;
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
  const tl = r.tiling;
  if (tl && tl.why) add('info', 'sub-block tiling not checked', '', 0, null, tl.why);
  else if (tl) {
    const v = (x) => `${fmtStat(x)} m³`, ps = (tl.parentSize || []).map((x) => fmtStat(x)).join(' × ');
    if (tl.overlap) add('error', 'sub-blocks overlap', '', tl.overlap, { recs: tl.overlapRecs }, `blocks claiming space another block of their parent already holds (the later of each pair) — ${tl.over.toLocaleString()} parent${tl.over === 1 ? '' : 's'} over by ${v(tl.overVolume)} in all`);
    if (tl.crossing) add('error', 'sub-block crosses its parent', '', tl.crossing, { recs: tl.crossingRecs }, `reaches past the ${ps} parent it starts in`);
    if (tl.offLattice) add('error', 'sub-block off its parent\'s lattice', '', tl.offLattice, { recs: tl.offLatticeRecs }, 'a corner or size that no tiling of the parent can have');
    if (tl.offGrid) add('error', 'sub-block centroid off the fine lattice', '', tl.offGrid, { recs: tl.offGridRecs });
    if (tl.ijkBad) add('error', 'IJK disagrees with the position', 'IJK', tl.ijkBad, { recs: tl.ijkRecs }, 'the parent the IJK names (Datamine order, K fastest) isn\'t the one the block sits in');
    if (tl.under) add('warn', 'parent not filled by its sub-blocks', '', tl.under, { at: tl.underAt }, `${tl.under.toLocaleString()} of ${tl.parents.toLocaleString()} ${ps} parents, ${v(tl.underVolume)} missing — a parent cut by topography or a domain edge is partly empty by design`);
    if (tl.revisited) add('info', 'a parent\'s sub-blocks not together', '', tl.revisited, null, 'their blocks came back after other parents\' — overlaps between the two runs are not checked (volume is)');
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
    else if (r.tiling && !r.tiling.why) {
      line('parents', `${r.tiling.parents.toLocaleString()} of ${r.tiling.parentSize.map((x) => fmtStat(x)).join('×')}`);
      line('tiling', r.tiling.overlap || r.tiling.crossing || r.tiling.offLattice ? '✗ broken' : r.tiling.under ? `${(100 * (r.tiling.parents - r.tiling.under) / r.tiling.parents).toFixed(1)}% full` : '✓ exact',
        r.tiling.overlap || r.tiling.crossing || r.tiling.offLattice ? SEV.error : null);
    } else line('lattice', `not checked — ${r.why}`, SEV.info);
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
              const ps = r.tiling && r.tiling.parentSize ? Math.max(...r.tiling.parentSize) : 0;
              zoomToPoint(at, Math.max(30, 3 * ps), 10);
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
    try { st.r = await modelQa(L, { signal: st.ctl.signal, onProgress: (n, what) => { win.sub.textContent = `checking ${what || 'blocks'}… ${n.toLocaleString()}`; } }); }
    catch (e) { st.err = e.message === 'cancelled' ? null : `model QA: ${e.message}`; }
    if (win.el.isConnected) render();
    return st.r;
  })();
  return entry;
}

// ── its palette commands (src/commands.js; the palette order is src/command-list.js) ──
registerCommands([
  { id: 'modelqa', group: 'Analysis', title: 'Model QA…', kw: 'block model check duplicates gaps holes sentinel -99 negative density outlier top cut lattice audit validate', when: (c) => !!(c.L && c.L.docs && c.L.docs.blockDoc && c.L.viewOf == null), run: (c) => openModelQa(c.L) },
]);
