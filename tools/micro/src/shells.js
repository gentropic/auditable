// micro — GRADE SHELLS: the surface around every block at or above a cutoff, as a
// mesh layer — contouring a volume. The model's column is read into a field on its
// lattice (a node per block centre), padded by one cell of "outside" so every shell
// closes, optionally smoothed (3×3×3 means), and contoured by MARCHING TETRAHEDRA:
// each cell of eight neighbouring centres split into six tetrahedra along one shared
// diagonal, so neighbouring cells agree on every face and the surface is watertight
// once the edge vertices are welded (no ambiguous cases, no 256-case tables). Where a
// missing block or the padding meets an inside block, the vertex sits halfway — on
// the block face. Triangles face outward (from high to low). The mesh opens as a
// layer (exact tier) — a solid for by-solid select / flag / ratio, Mesh QA's volume,
// and every mesh export. Regular, axis-aligned lattices; the window says otherwise.
import { layerRecords, layerTableHeader, numOf, schemaExt } from './records.js';
import { floatWin, raiseWindow } from './windows.js';
import { numericColsOf } from './analysis.js';
import { mkLineage } from './lineage.js';
import { ingestMeshLayer } from './ingest.js';
import { layerById } from './state.js';
const $ = (s) => document.querySelector(s);
const FIELD_MAX = 64e6;                                    // cells (incl. the padding) read into one Float32Array

function latticeOf(L) {
  const h = L.docs && L.docs.blockDoc && L.docs.blockDoc.header;
  if (!h) return { why: 'not a block model' };
  const g = h.grid;
  if (!g) return { why: 'the model has no block grid (opened as points)' };
  if (g.rot) return { why: 'a rotated model — shells are drawn on axis-aligned lattices' };
  if (h.subBlocked) return { why: 'a sub-blocked model — shells need a regular lattice' };
  return { g };
}

/** Read `col` into a padded field: Float32Array (nx+2)(ny+2)(nz+2), NaN = no block / outside. */
export async function readField(L, col, { onlyFiltered = false, signal = null, onProgress = null } = {}) {
  const lt = latticeOf(L); if (!lt.g) throw new Error(lt.why);
  const g = lt.g, nx = g.x.count + 2, ny = g.y.count + 2, nz = g.z.count + 2;
  if (nx * ny * nz > FIELD_MAX) throw new Error(`the lattice has ${(nx * ny * nz / 1e6).toFixed(0)}M cells — over ${FIELD_MAX / 1e6}M; filter or crop the model first`);
  const h = layerTableHeader(L), m = h.mapping;
  const ci = schemaExt(L, h).map((c) => c.name).indexOf(col);
  if (ci < 0) throw new Error(`no column ${col}`);
  const F = new Float32Array(nx * ny * nz).fill(NaN);
  const mask = onlyFiltered && L._filterMask ? L._filterMask : null;
  let n = 0;
  for await (const { f, rec } of layerRecords(L)) {
    if (signal && signal.aborted) throw new Error('cancelled');
    if (mask && !mask[rec]) continue;
    const i = Math.round((numOf(f[m.x]) - g.x.origin) / g.x.pitch) + 1, j = Math.round((numOf(f[m.y]) - g.y.origin) / g.y.pitch) + 1, k = Math.round((numOf(f[m.z]) - g.z.origin) / g.z.pitch) + 1;
    if (!(i >= 1 && j >= 1 && k >= 1 && i < nx - 1 && j < ny - 1 && k < nz - 1)) continue;
    const v = numOf(f[ci]);
    if (Number.isFinite(v)) F[i + nx * (j + ny * k)] = v;
    if (onProgress && ++n % 100000 === 0) { onProgress(n); await new Promise((r) => setTimeout(r, 0)); }
  }
  return { F, nx, ny, nz, g };
}

/** 3×3×3 mean over the blocks that exist (missing stays missing). */
export function smoothField(fd, passes = 1) {
  const { nx, ny, nz } = fd;
  let F = fd.F;
  for (let p = 0; p < passes; p++) {
    const O = new Float32Array(F.length).fill(NaN);
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = i + nx * (j + ny * k); if (Number.isNaN(F[c])) continue;
      let s = 0, w = 0;
      for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = F[c + di + nx * (dj + ny * dk)]; if (!Number.isNaN(v)) { s += v; w++; } }
      O[c] = s / w;
    }
    F = O;
  }
  return { ...fd, F };
}

// the cube's 8 corners (bit i of the offsets) and its six tetrahedra around the 0–7 diagonal
const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const TETS = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]];

/**
 * Contour the field at `cutoff` (inside: value ≥ cutoff). → { vertices: Float64Array
 * (world x,y,z), triangles: Uint32Array, blocksInside }.
 */
export function contourField(fd, cutoff) {
  const { F, nx, ny, nz, g } = fd;
  const X = (i) => g.x.origin + (i - 1) * g.x.pitch, Y = (j) => g.y.origin + (j - 1) * g.y.pitch, Z = (k) => g.z.origin + (k - 1) * g.z.pitch;
  const inside = (v) => v >= cutoff;                       // NaN → false: outside
  const verts = [], tris = [], edgeV = new Map();
  let blocksInside = 0;
  for (let c = 0; c < F.length; c++) if (inside(F[c])) blocksInside++;
  const vertexOn = (a, b) => {                             // a, b: node indices (inside / outside)
    const key = a < b ? a * F.length + b : b * F.length + a;   // ≤ 2^52 for 64M cells: exact
    let vi = edgeV.get(key);
    if (vi !== undefined) return vi;
    const va = F[a], vb = F[b];
    let t = 0.5;                                           // a missing neighbour: the block face
    if (!Number.isNaN(va) && !Number.isNaN(vb) && va !== vb) t = Math.max(0, Math.min(1, (cutoff - va) / (vb - va)));
    const ia = a % nx, ja = Math.floor(a / nx) % ny, ka = Math.floor(a / (nx * ny));
    const ib = b % nx, jb = Math.floor(b / nx) % ny, kb = Math.floor(b / (nx * ny));
    vi = verts.length / 3;
    verts.push(X(ia) + t * (X(ib) - X(ia)), Y(ja) + t * (Y(jb) - Y(ja)), Z(ka) + t * (Z(kb) - Z(ka)));
    edgeV.set(key, vi);
    return vi;
  };
  const P = (vi) => [verts[3 * vi], verts[3 * vi + 1], verts[3 * vi + 2]];
  const nodeP = (n) => [X(n % nx), Y(Math.floor(n / nx) % ny), Z(Math.floor(n / (nx * ny)))];
  // a triangle facing from the inside nodes toward the outside ones
  const emit = (v0, v1, v2, inN, outN) => {
    const a = P(v0), b = P(v1), c = P(v2);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const pi = nodeP(inN), po = nodeP(outN);
    const dir = [po[0] - pi[0], po[1] - pi[1], po[2] - pi[2]];
    if (nrm[0] * dir[0] + nrm[1] * dir[1] + nrm[2] * dir[2] < 0) tris.push(v0, v2, v1); else tris.push(v0, v1, v2);
  };
  const node = new Int32Array(8), ins = new Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let any = false, all = true;
    for (let q = 0; q < 8; q++) { const o = CORNER[q]; node[q] = (i + o[0]) + nx * ((j + o[1]) + ny * (k + o[2])); ins[q] = inside(F[node[q]]); if (ins[q]) any = true; else all = false; }
    if (!any || all) continue;
    for (const tet of TETS) {
      const I = [], O = [];
      for (const q of tet) (ins[q] ? I : O).push(node[q]);
      if (I.length === 0 || I.length === 4) continue;
      if (I.length === 1) emit(vertexOn(I[0], O[0]), vertexOn(I[0], O[1]), vertexOn(I[0], O[2]), I[0], O[0]);
      else if (I.length === 3) emit(vertexOn(I[0], O[0]), vertexOn(I[1], O[0]), vertexOn(I[2], O[0]), I[0], O[0]);
      else {                                               // two in, two out: a quad
        const a = vertexOn(I[0], O[0]), b = vertexOn(I[0], O[1]), c = vertexOn(I[1], O[1]), d = vertexOn(I[1], O[0]);
        emit(a, b, c, I[0], O[0]); emit(a, c, d, I[0], O[0]);
      }
    }
  }
  return { vertices: Float64Array.from(verts), triangles: Uint32Array.from(tris), blocksInside };
}

/** Read, smooth, contour and open as a mesh layer. Resolves to { id, triangles, blocksInside }. */
export async function gradeShell(L, { col, cutoff, smooth = 0, onlyFiltered = false, name = null, signal = null, onProgress = null } = {}) {
  if (!Number.isFinite(+cutoff)) throw new Error('a cutoff is needed');
  let fd = await readField(L, col, { onlyFiltered, signal, onProgress });
  if (smooth > 0) fd = smoothField(fd, Math.min(3, smooth | 0));
  const m = contourField(fd, +cutoff);
  if (!m.triangles.length) throw new Error(`no block of ${col} reaches ${cutoff}${onlyFiltered ? ' among the filtered ones' : ''}`);
  const nm = name || `${col} ≥ ${+cutoff} shell${smooth ? ` (smoothed ×${smooth})` : ''}`;
  const lineage = mkLineage('shell', { col, cutoff: +cutoff, smooth, onlyFiltered, filter: onlyFiltered ? L.filterExpr || '' : undefined }, [{ name: L.label || L.name, kind: 'blocks' }]);
  const id = await ingestMeshLayer({ vertices: m.vertices, triangles: m.triangles }, nm.replace(/[\\/:*?"<>|]+/g, '-'), lineage);
  const NL = layerById(id);
  if (NL) { NL.memoryOnly = true; NL.label = nm; }
  return { id, triangles: m.triangles.length / 3, vertices: m.vertices.length / 3, blocksInside: m.blocksInside };
}

let _win = null;
export function openGradeShell(L) {
  const lt = latticeOf(L);
  if (!lt.g) { $('#meta').textContent = `grade shell: ${lt.why}`; return null; }
  if (_win && _win.el.isConnected) _win.close();
  const cols = numericColsOf(L);
  if (!cols.length) { $('#meta').textContent = 'grade shell: the model has no numeric column'; return null; }
  const win = floatWin({ title: 'grade shell', sub: L.label || L.name, x: Math.max(12, innerWidth - 360), y: 110, w: 330, h: 300, onClose: () => { _win = null; } });
  _win = win;
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px';
  const field = (label, el, title) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; if (title) r.title = title; const s = document.createElement('span'); s.style.cssText = 'flex:1;color:var(--text)'; s.textContent = label; r.append(s, el); win.body.appendChild(r); return el; };
  const colSel = document.createElement('select'); colSel.className = 'sw-sel'; for (const c of cols) colSel.append(new Option(c, c));
  const cs = L.colorSel && String(L.colorSel).startsWith('chan:') ? (layerTableHeader(L).columns[+String(L.colorSel).slice(5)]) : null;
  if (cs && cols.includes(cs)) colSel.value = cs;
  field('column', colSel);
  const cut = document.createElement('input'); cut.className = 'sw-in'; cut.style.cssText = 'flex:0 0 96px;width:96px'; cut.placeholder = 'e.g. 0.5';
  field('cutoff (≥)', cut, 'the shell encloses every block at or above this value');
  const sm = document.createElement('select'); sm.className = 'sw-sel'; for (const [v, t] of [['0', 'none (the blocks as they are)'], ['1', 'light'], ['2', 'medium'], ['3', 'strong']]) sm.append(new Option(t, v));
  field('smoothing', sm, '3×3×3 means of the blocks before contouring — off by default: the shell shows the blockiness the model has');
  const fl = document.createElement('input'); fl.type = 'checkbox'; fl.disabled = !L._filterMask;
  field('only the filtered blocks', fl, L._filterMask ? `only blocks matching “${L.filterExpr}” count as inside` : 'no filter on this layer');
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  note.textContent = 'a closed mesh layer — use it as a solid (select / flag by solid), check its volume in Mesh QA, export it like any mesh';
  win.body.appendChild(note);
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Make shell';
  const msg = document.createElement('span'); msg.style.cssText = 'flex:1;color:var(--muted)';
  row.append(go, msg); win.body.appendChild(row);
  go.onclick = async () => {
    const c = parseFloat(String(cut.value).replace(',', '.'));
    if (!Number.isFinite(c)) { msg.textContent = 'type a cutoff'; return; }
    go.disabled = true; msg.textContent = 'reading the model…';
    try {
      const r = await gradeShell(L, { col: colSel.value, cutoff: c, smooth: +sm.value, onlyFiltered: fl.checked, onProgress: (n) => { msg.textContent = `reading… ${n.toLocaleString()} blocks`; } });
      msg.textContent = `${r.triangles.toLocaleString()} triangles around ${r.blocksInside.toLocaleString()} blocks`;
      $('#meta').textContent = `grade shell: ${colSel.value} ≥ ${c} — ${r.triangles.toLocaleString()} triangles`;
    } catch (e) { msg.textContent = e.message; }
    finally { go.disabled = false; }
  };
  return win;
}
