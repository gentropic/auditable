// micro samples — everything made locally for a first look: the streamed bench scan (2M–50M
// points), the 2M-block sample model, and the demo project (a deposit, drillholes, topography,
// mining phases, the ore shell — sectioned, with grade–tonnage), and Site C (gold in a folded
// banded iron formation: the deposit the manual's cover is drawn from). Nothing is downloaded.
// Carved from index.html (2026-11-24).
import { mulberry32, createChunkBuilder } from '../../../ext/condenser/src/main.js';
import { captureCamera } from './camera.js';
import { writeEsriAsc } from './grid-io.js';
import { requestRender, S, layerById, activeLayer } from './state.js';
import { openGradeTonnage } from './gt.js';
import { openBlob, openDrillholeLayer } from './open.js';
import { setColorLabels, colorSelFor, setLayerColorBy } from './color.js';
import { applyCatLegend } from './categories.js';
import * as SC from './site-c.js';
import { reopenAs } from './reopen.js';
import { followLayer, createLayerGroup, applyTreeVisibility } from './tree.js';
import { renderLayers } from './layers-panel.js';
import { closeAllLayers, allocLayerId, fitFromHeader, recomputeUnion, setActiveLayer } from './layers.js';
import { setMeshTint } from './layermenu.js';
import { applySection, captureSection } from './section.js';
import { renderer, setCameraWorld } from './viewport.js';

const $ = (s) => document.querySelector(s);

// Synthetic sample: a bench scan generated STREAMING into RawChunks (no LAS bytes,
// no fetch, and never all resident — the builder consumes each RawChunk as it's
// made, so 50M points generate inside the same bounded-memory envelope as a file).
// The patch scales with n so density stays LiDAR-ish (~1250 pts/m²).
function* sampleRawChunks(n) {
  const rnd = mulberry32(42);
  const per = 1 << 18;
  const scale = Math.sqrt(n / 2_000_000);
  const x0 = 610000, y0 = 7760000, z0 = 900, w = 400 * scale, h = 400 * scale;
  for (let start = 0; start < n; start += per) {
    const m = Math.min(per, n - start);
    const x = new Float64Array(m), y = new Float64Array(m), z = new Float64Array(m);
    const intensity = new Uint16Array(m), classification = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      const px = x0 + rnd() * w, py = y0 + rnd() * h;
      const benches = 5 * scale;
      const bench = Math.floor(((px - x0) / w) * benches) * 10;
      const wall = ((px - x0) / w * benches) % 1 > 0.92 ? (rnd() * 9) : 0;   // near-vertical faces
      x[i] = px; y[i] = py;
      z[i] = z0 - bench - wall + Math.sin((py - y0) / 40) * 1.5 + rnd() * 0.25;
      intensity[i] = 1000 + (rnd() * rnd() * 50000) | 0;
      classification[i] = wall ? 6 : 2;
    }
    yield { count: m, x, y, z, intensity, classification, rgb: null, recStart: start };
  }
}
export async function openSample(n = 2_000_000) {
  closeAllLayers(); requestRender();
  const lid = allocLayerId();
  S.layers.push({ id: lid, name: 'sample bench scan', kind: 'points', docs: {}, bboxLocal: null, colorSel: '0', clip: ['', ''], filterExpr: '', visible: true });
  S.activeId = lid;
  setColorLabels(null);
  $('#empty').style.display = 'none';
  $('#meta').textContent = 'sample — generating…';
  await new Promise((r) => setTimeout(r));
  const scale = Math.sqrt(n / 2_000_000);
  const x0 = 610000, y0 = 7760000, z0 = 900, w = 400 * scale, h = 400 * scale;
  const header = { count: n, bbox: { min: [x0, y0, z0 - 12 * 5 * scale], max: [x0 + w, y0 + h, z0 + 2] } };
  fitFromHeader(header, true);
  const cb = createChunkBuilder({ frame: S.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { renderer.addChunk(c, 'base', lid); requestRender(); } });
  let done = 0;
  for (const rc of sampleRawChunks(n)) {
    cb.push(rc); done += rc.count;
    if ((done & 0xfffff) < (1 << 18)) { $('#meta').textContent = `sample — generating ${Math.round(100 * done / n)}%`; await new Promise((r) => setTimeout(r)); }
  }
  const doc = cb.flush();
  const Ls = layerById(lid); if (Ls) Ls.bboxLocal = doc.bboxLocal;
  recomputeUnion();
  renderLayers();
  $('#meta').textContent = `sample bench scan — ${doc.count.toLocaleString()} points (synthetic, generated locally)`;
  requestRender();
}
document.querySelectorAll('[data-sample]').forEach((a) => a.onclick = () => openSample(+a.dataset.sample));

// Synthetic QF block model AS A CSV BLOB — exercises the full provider path
// (sniff → discovery sweep → grid inference → impostors). A 200×100×100 grid
// (10×10×5 m blocks, UTM-ish coords) CARVED BY A BENCHED OPEN PIT over an
// ellipsoidal Fe lens — grade zonation outcrops in the pit bottom, benches
// step the walls, and the model has air above it like a real export.
export function makeSampleBlockCsv() {
  const nx = 200, ny = 100, nz = 100, dx = 10, dy = 10, dz = 5;
  const x0 = 612000, y0 = 7765000, z0 = 400;
  const parts = ['XC,YC,ZC,FE,LITO\n'];
  let rows = [];
  const rnd = mulberry32(7);
  const benchBlocks = 2;                                   // 10 m benches (2 blocks)
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // benched pit: depth grows toward the lens center, quantized to benches
        const gx = (i - nx * 0.5) / (nx * 0.42), gy = (j - ny * 0.45) / (ny * 0.42);
        const pitDepth = Math.max(0, 240 * Math.exp(-(gx * gx + gy * gy) * 1.9) - 10);
        const kSurf = nz - 1 - Math.floor(pitDepth / dz / benchBlocks) * benchBlocks;
        if (k > kSurf) continue;                           // air (mined out / above topo)
        const x = x0 + i * dx, y = y0 + j * dy, z = z0 + k * dz;
        // an ellipsoidal high-grade lens, dipping in x
        const u = (i - nx * 0.5 - (k - nz / 2) * 0.35) / (nx * 0.22), v = (j - ny * 0.45) / (ny * 0.3), w = (k - nz * 0.55) / (nz * 0.28);
        const d2 = u * u + v * v + w * w;
        const fe = Math.max(8, Math.min(68, 62 - d2 * 30 + (rnd() - 0.5) * 6));
        const lito = d2 < 0.8 ? (k > nz * 0.7 ? 'HEMATITE' : 'ITABIRITE') : (k > nz * 0.8 ? 'CANGA' : 'WASTE');
        rows.push(`${x},${y},${z},${fe.toFixed(2)},${lito}`);
      }
    }
    parts.push(rows.join('\n') + '\n'); rows = [];
  }
  return new Blob(parts, { type: 'text/csv' });
}
$('#sampleBlocks').onclick = async () => {
  $('#empty').style.display = 'none';
  $('#meta').textContent = 'sample block model — generating csv…';
  await new Promise((r) => setTimeout(r));
  await openBlob(makeSampleBlockCsv(), 'sample_blockmodel.csv', 'replace');
};

// ── the DEMO PROJECT — the coming-home aha. A dressed session: a block model +
// drillholes, coloured by grade, cut by a section through the ore lens, with a
// grade–tonnage curve — so a newcomer meets the whole resource-geology workflow
// in one click, not a viewer they must learn to drive. It's in-memory; File →
// Save project as… writes it to a real folder they can inspect (the auditable
// "your data is just a folder you own" story), and Save also persists the
// bookmark + the pinned grade-tonnage window. ──
const _DEMO = { nx: 200, ny: 100, nz: 100, dx: 10, dy: 10, dz: 5, x0: 612000, y0: 7765000, z0: 400 };
// FE grade at a WORLD position, from the same ellipsoidal dipping lens the block
// sample uses — so the drillholes intersect the ore exactly where the model shows it.
// deterministic SPATIAL value-noise (incommensurate waves): the same value at
// the same (x,y,z) — so the drillholes and the model agree exactly, texture
// included, which the old per-sample white noise never did
function _demoNoise(x, y, z) {
  return Math.sin(x * 0.011 + Math.sin(y * 0.017) * 2) * 0.35
       + Math.sin(y * 0.023 + Math.sin(z * 0.041) * 2) * 0.25
       + Math.sin(z * 0.057 + Math.sin(x * 0.007) * 2) * 0.2
       + Math.sin((x + y * 0.7) * 0.0047) * 0.2;           // ≈ [-1, 1]
}
function _demoFeAt(x, y, z, rnd) {
  const D = _DEMO;
  const i = (x - D.x0) / D.dx, j = (y - D.y0) / D.dy, k = (z - D.z0) / D.dz;
  const u = (i - D.nx * 0.5 - (k - D.nz / 2) * 0.35) / (D.nx * 0.22), v = (j - D.ny * 0.45) / (D.ny * 0.3), w = (k - D.nz * 0.55) / (D.nz * 0.28);
  const d2 = u * u + v * v + w * w;
  const n = _demoNoise(x, y, z);
  // ore membership: a SIGMOID shoulder (bimodal FE, not a grade cone), with the
  // boundary itself wobbled by the noise — no concentric shells
  const m = 1 / (1 + Math.exp((d2 + n * 0.35 - 0.75) * 6));
  // enrichment shoots: two high-grade pods along the lens axis
  const p1 = (u - 0.45) * (u - 0.45) * 1.8 + (v - 0.2) * (v - 0.2) * 2.0 + w * w * 1.5;
  const p2 = (u + 0.5) * (u + 0.5) * 2.0 + (v + 0.25) * (v + 0.25) * 1.6 + (w - 0.2) * (w - 0.2) * 1.8;
  const shoot = Math.max(Math.exp(-p1 * 2.2), Math.exp(-p2 * 2.2));
  const waste = 22 + n * 9;                                // 13–31: canga/itabirite background
  const ore = 58.5 + n * 5 + shoot * 9;                    // 53–68: itabirite → a hematite core above 60, pods run high
  const fe = waste + (ore - waste) * m + ((rnd ? rnd() : 0.5) - 0.5) * 3;   // ±1.5 measurement jitter
  return Math.max(8, Math.min(68, fe));
}
const _demoSg = (fe) => +(2.5 + (fe / 68) * 2.0).toFixed(2);   // iron ore: ~2.5 waste → ~4.5 hematite
// the pre-mining ground — the model's top is carved from it; collars sit on it
const _demoTopoAt = (x, y) => { const D = _DEMO, zTop = D.z0 + (D.nz - 1) * D.dz; return zTop + 4 + 9 * Math.sin((x - D.x0) / 260) * Math.cos((y - D.y0) / 210) + 6 * Math.sin((x + y - D.x0 - D.y0) / 610); };
// ONE rock model for the blocks AND the holes (so a hole's LITO and FE agree with the blocks it
// crosses): the lens membership decides ore; within it the friable HEMATITE core runs ≥ 60% Fe,
// ITABIRITE carries the rest of the ore and a lower-grade halo; a CANGA duricrust caps the top
// 25 m outside the ore (ferruginous, 46–58% Fe — not the 13–31 country rock it used to be); the
// rest is WASTE (phyllite/quartzite, 13–31%). The old LITO came from a second, different ellipsoid
// and only named the top of the lens HEMATITE — 114 blocks, most of them mined out.
function _demoRock(x, y, z, rnd) {
  const D = _DEMO;
  const i = (x - D.x0) / D.dx, j = (y - D.y0) / D.dy, k = (z - D.z0) / D.dz;
  const u = (i - D.nx * 0.5 - (k - D.nz / 2) * 0.35) / (D.nx * 0.22), v = (j - D.ny * 0.45) / (D.ny * 0.3), w = (k - D.nz * 0.55) / (D.nz * 0.28);
  const n = _demoNoise(x, y, z);
  const m = 1 / (1 + Math.exp((u * u + v * v + w * w + n * 0.35 - 0.75) * 6));   // ore membership (the same as _demoFeAt's)
  let fe = _demoFeAt(x, y, z, rnd), lito;
  const nearTop = z > D.z0 + (D.nz - 1) * D.dz - 25;
  if (m >= 0.5) lito = fe >= 60 ? 'HEMATITE' : 'ITABIRITE';
  else if (nearTop) { lito = 'CANGA'; fe = Math.max(fe, 52 + n * 6 + ((rnd ? rnd() : 0.5) - 0.5) * 2); }
  else if (m >= 0.12) lito = 'ITABIRITE';                  // the low-grade halo
  else lito = 'WASTE';
  return { fe: Math.max(8, Math.min(68, fe)), lito };
}
// block model with FE + SG (density → real grade-tonnage) + LITO
export function makeDemoBlockCsv() {
  const D = _DEMO, parts = ['XC,YC,ZC,FE,SG,LITO\n']; let rows = [];
  const rnd = mulberry32(7), benchBlocks = 2;
  for (let k = 0; k < D.nz; k++) {
    for (let j = 0; j < D.ny; j++) {
      for (let i = 0; i < D.nx; i++) {
        const gx = (i - D.nx * 0.5) / (D.nx * 0.42), gy = (j - D.ny * 0.45) / (D.ny * 0.42);
        const pitDepth = Math.max(0, 240 * Math.exp(-(gx * gx + gy * gy) * 1.9) - 10);
        const kSurf = D.nz - 1 - Math.floor(pitDepth / D.dz / benchBlocks) * benchBlocks;
        if (k > kSurf) continue;
        const x = D.x0 + i * D.dx, y = D.y0 + j * D.dy, z = D.z0 + k * D.dz;
        const { fe, lito } = _demoRock(x, y, z, rnd);
        rows.push(`${x},${y},${z},${fe.toFixed(2)},${_demoSg(fe)},${lito}`);
      }
    }
    parts.push(rows.join('\n') + '\n'); rows = [];
  }
  return new Blob(parts, { type: 'text/csv' });
}
// a small vertical drillhole set threading the deposit — collar + survey + assay,
// FE from the same lens so the holes agree with the model (collar/survey/assay
// column conventions per the @gcu/condenser drillhole provider)
export function makeDemoDrillholes() {
  // four N–S drill lines across the E–W-striking lens; on each, a FAN of three holes from one collar
  // on the pre-mining ground, south of the lens, drilled north at −45°, −60° and −75° — the way a
  // lens like this is drilled, and the reason holes cross the demo's own E–W section (the old set
  // was twelve vertical holes in three E–W rows: a slab at the section crossed none of them).
  // Assays carry FE, SG and LITO from the SAME rock model as the blocks; surveys a station at the
  // collar and at end of hole (straight holes — desurvey places them exactly where they sampled).
  const D = _DEMO, rnd = mulberry32(11);
  const collar = ['HOLEID,X,Y,Z,EOH,COMPANY'], survey = ['HOLEID,DEPTH,AZ,DIP'], assay = ['HOLEID,FROM,TO,FE,SG,LITO'];
  const cx = D.x0 + D.nx * 0.5 * D.dx, cy = D.y0 + D.ny * 0.45 * D.dy;
  const lines = [-300, -100, 100, 300], dips = [45, 60, 75];
  let n = 0;
  for (const off of lines) {
    const x0 = cx + off, y0 = cy - 220, z0 = +_demoTopoAt(x0, y0).toFixed(1);
    for (const dip of dips) {
      const id = `DH${String(++n).padStart(3, '0')}`;
      // two campaigns: PIONEER's early scout holes stopped shallow; MERIDIAN drilled through —
      // so the hole filter + broadcast have real hole-granularity data (EOH, COMPANY)
      const pioneer = n % 3 === 1;
      const maxDp = pioneer ? 150 : 520;
      const sd = Math.sin(dip * Math.PI / 180), cd = Math.cos(dip * Math.PI / 180);
      let eoh = 0;
      for (let dp = 0; dp < maxDp; dp += 5) {
        const t = dp + 2.5, z = z0 - t * sd, y = y0 + t * cd;     // azimuth 0: north
        if (z < D.z0) break;
        const r = _demoRock(x0, y, z, rnd);
        assay.push(`${id},${dp},${dp + 5},${r.fe.toFixed(2)},${_demoSg(r.fe)},${r.lito}`);
        eoh = dp + 5;
      }
      survey.push(`${id},0,0,-${dip}`, `${id},${eoh},0,-${dip}`);
      collar.push(`${id},${x0.toFixed(1)},${y0.toFixed(1)},${z0},${eoh},${pioneer ? 'PIONEER' : 'MERIDIAN'}`);
    }
  }
  return {
    collar: new File([collar.join('\n') + '\n'], 'demo_collars.csv'),
    survey: new File([survey.join('\n') + '\n'], 'demo_survey.csv'),
    intervals: new File([assay.join('\n') + '\n'], 'demo_assay.csv'),
  };
}
// pre-mining topography + three pit phases on ONE small lattice — the SAME
// gaussian the block generator carves with, taken at fractions, so the final
// phase matches the deposit's void exactly. Closed-form → generated on demand.
function makeDemoSurfaces() {
  const D = _DEMO;
  const dx = 20, pad = 160;
  const x0 = D.x0 - pad, yTop = D.y0 + (D.ny - 1) * D.dy + pad;
  const nx = Math.round((D.nx * D.dx + 2 * pad) / dx) + 1, ny = Math.round((D.ny * D.dy + 2 * pad) / dx) + 1;
  const zTop = D.z0 + (D.nz - 1) * D.dz;                   // the pre-pit ground the model is carved from
  const topoAt = _demoTopoAt;                             // the same ground the collars sit on
  const pitAt = (x, y) => {
    const gx = ((x - D.x0) / D.dx - D.nx * 0.5) / (D.nx * 0.42), gy = ((y - D.y0) / D.dy - D.ny * 0.45) / (D.ny * 0.42);
    return Math.max(0, 240 * Math.exp(-(gx * gx + gy * gy) * 1.9) - 10);
  };
  const mk = (f) => {
    const data = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      const x = x0 + c * dx, y = yTop - r * dx;
      const t = topoAt(x, y);
      const pd = f == null ? 0 : pitAt(x, y);
      data[r * nx + c] = f == null ? t : (pd <= 0 ? -9999 : Math.min(t, zTop - 2 - f * pd));   // a shell exists only IN the bowl
    }
    return { nx, ny, dx, dy: dx, x0, y0: yTop, data, nodata: -9999 };
  };
  return { topo: mk(null), phases: [mk(0.35), mk(0.7), mk(1)] };
}
// the ore shell: the block generator's lens ellipsoid (d² < 0.8, sheared with
// depth — the dip the drillholes chase) as a closed OBJ sphere mesh
function makeDemoShellObj() {
  const D = _DEMO;
  const cx = D.x0 + D.nx * 0.5 * D.dx, cy = D.y0 + D.ny * 0.45 * D.dy, cz = D.z0 + D.nz * 0.55 * D.dz;
  const q = Math.sqrt(0.8);
  const rx = D.nx * 0.22 * D.dx * q, ry = D.ny * 0.3 * D.dy * q, rz = D.nz * 0.28 * D.dz * q;
  const shear = 0.35 * (D.dx / D.dz);
  const NU = 28, NV = 14, out = ['# demo ore shell\n'];
  for (let b = 0; b <= NV; b++) {
    const phi = (b / NV) * Math.PI;
    for (let a2 = 0; a2 < NU; a2++) {
      const th = (a2 / NU) * 2 * Math.PI;
      const px = Math.sin(phi) * Math.cos(th), py = Math.sin(phi) * Math.sin(th), pz = Math.cos(phi);
      const z = cz + pz * rz;
      out.push(`v ${(cx + px * rx + shear * (z - cz)).toFixed(2)} ${(cy + py * ry).toFixed(2)} ${z.toFixed(2)}\n`);
    }
  }
  const at = (b, a2) => b * NU + (((a2 % NU) + NU) % NU) + 1;
  for (let b = 0; b < NV; b++) for (let a2 = 0; a2 < NU; a2++) {
    out.push(`f ${at(b, a2)} ${at(b + 1, a2)} ${at(b + 1, a2 + 1)}\n`);
    out.push(`f ${at(b, a2)} ${at(b + 1, a2 + 1)} ${at(b, a2 + 1)}\n`);
  }
  return new Blob(out, { type: 'text/plain' });
}
// a heightfield grid → an OBJ mesh (so a context surface can live in the MESH
// layer pool instead of spending one of the seven element slots)
function gridToObjBlob(g) {
  const { nx, ny, x0, y0, dx, dy, data } = g;
  const nd = Number.isFinite(g.nodata) ? g.nodata : null;   // a SENTINEL is finite — honour it, or the
  const hole = (v) => !Number.isFinite(v) || v === nd;      // holes become vertices on a floor 10 km down
  const idx = new Int32Array(nx * ny).fill(-1);
  const out = [];
  let n = 0;
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const v = data[r * nx + c];
      if (hole(v)) continue;
      idx[r * nx + c] = ++n;                               // OBJ is 1-based
      out.push(`v ${(x0 + c * dx).toFixed(3)} ${(y0 - r * dy).toFixed(3)} ${v.toFixed(3)}`);
    }
  }
  for (let r = 0; r < ny - 1; r++) {
    for (let c = 0; c < nx - 1; c++) {
      const a = idx[r * nx + c], b = idx[r * nx + c + 1], d = idx[(r + 1) * nx + c], e = idx[(r + 1) * nx + c + 1];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      out.push(`f ${a} ${d} ${e}`, `f ${a} ${e} ${b}`);
    }
  }
  return new Blob([out.join('\n') + '\n'], { type: 'text/plain' });
}
export async function openDemoProject() {
  $('#empty').style.display = 'none';
  $('#meta').textContent = 'demo project — assembling a block model…';
  await new Promise((r) => setTimeout(r));
  await openBlob(makeDemoBlockCsv(), 'deposit.csv', 'replace');   // lands grade-coloured (FE)
  const bm = activeLayer();
  $('#meta').textContent = 'demo project — desurveying drillholes…';
  let dh = null;
  try { await openDrillholeLayer(makeDemoDrillholes(), { radius: 6 }, 'add'); dh = activeLayer(); }
  catch (e) { $('#meta').textContent = `demo drillholes failed — ${e.message}`; }
  // terrain + mining phases + the ore shell — the story AROUND the model
  $('#meta').textContent = 'demo project — building terrain, phases, the ore shell…';
  try {
    const sf = makeDemoSurfaces();
    const openSurf = async (grid, name, label) => {
      const _got = await openBlob(new Blob([writeEsriAsc(grid)]), name, 'add');
      const gl2 = layerById(_got);
      if (gl2) await reopenAs(gl2, 'surface');             // shaded relief, not an elevation point cloud
      const L = layerById(followLayer(_got));
      if (L) L.label = label;
      return L;
    };
    const topoL = await openSurf(sf.topo, 'topo.asc', 'topography');
    if (topoL) { topoL.opacity = 0.35; renderer.setLayerOpacity(topoL.id, 0.35); }   // a veil, not a lid — the grades stay the hero
    const PH = ['phase 1 — starter pit', 'phase 2 — cutback', 'phase 3 — final pit'];
    const phIds = [];
    for (let i = 0; i < 3; i++) {                          // phases are CONTEXT → meshes, not grids: they must not
      await openBlob(gridToObjBlob(sf.phases[i]), `phase${i + 1}.obj`, 'add');   // spend the visitor's element-layer budget
      const L = activeLayer();
      if (L) { L.label = PH[i]; setMeshTint(L, '#7a8794'); L.opacity = 0.5; renderer.setLayerOpacity(L.id, 0.5); phIds.push(L.id); if (i !== 0) L.visible = false; }
    }
    if (phIds.length) createLayerGroup('mining phases', phIds, { collapsed: true });
    applyTreeVisibility();
    await openBlob(makeDemoShellObj(), 'ore_shell.obj', 'add');
    const shellL = activeLayer();
    if (shellL && shellL.kind === 'mesh') { shellL.label = 'ore shell'; setMeshTint(shellL, '#c8722e'); shellL.opacity = 0.7; renderer.setLayerOpacity(shellL.id, 0.7); }
  } catch (e) { $('#meta').textContent = `demo surfaces — ${e.message}`; }
  // half-cut the model E–W through the ore lens (opens the deposit on the grade
  // interior); the drillholes stay WHOLE (per-layer "don't cut") so they thread
  // the full deposit for context — exactly the section-with-holes view a geologist reads
  applySection({ mode: 'ew', clip: 'behind', pos: 0.45 });
  if (dh) renderer.setLayerSectioned(dh.id, false);
  // a bookmark on this view (persists once the project is saved)
  try { S.views = S.views.filter((v) => v.name !== 'Ore lens — E–W section').concat([{ name: 'Ore lens — E–W section', camera: captureCamera(), section: captureSection() }]); } catch { /* view capture best-effort */ }
  $('#btnFit').click();
  // a grade–tonnage window on the model (FE grade, SG density) — computed, so the
  // newcomer sees the curve, not an empty panel — DOCKED RIGHT so the model stays the hero
  if (bm) {
    setActiveLayer(bm.id);
    try {
      openGradeTonnage(bm, { run: true, cfg: { series: [{ layer: bm.name, col: 'FE', unit: 'pct', weight: 'SG' }], gradeUnit: 'pct', densUnit: 't/m3', nCut: 40 } });   // tonnes, not volume: SG is the density, FE is in %
      const gtWin = [...document.querySelectorAll('.fwin')].pop();
      if (gtWin) { gtWin.style.left = Math.max(0, innerWidth - gtWin.offsetWidth - 14) + 'px'; gtWin.style.top = '70px'; }
    } catch { /* window optional */ }
  }
  $('#meta').textContent = 'demo project — a deposit, drillholes, topography, mining phases and the ore shell, sectioned, with grade–tonnage. File → Save project as… writes it all to a folder.';
}
$('#sampleDemo').onclick = () => openDemoProject();

// ── Site C: gold in a folded banded iron formation ────────────────────────────────────────────────────────
// An imaginary deposit as one implicit model (src/site-c.js): a shelf sequence folded into a plunging
// antiform, faulted, intruded by a granite stock with skarn; gold where the BIF thickens in the fold hinge.
// The manual's cover is its geological map and three serial sections, drawn from the same functions — open
// it here and cut those sections yourself. Coordinates are the map's (imaginary UTM 23S).
const SITE_C_SG = { REGOLITH: 1.9, GNEISS: 2.7, QUARTZITE: 2.65, BIF: 3.3, MARBLE: 2.8, PHYLLITE: 2.75, METAVOLCANICS: 2.9, GRANITE: 2.65, SKARN: 3.2 };
const SITE_C_BLOCK = { dx: 20, dy: 20, dz: 10 };
const scShort = (u) => SC.UNITS[u].short;
// the block model: every block centre under the topography, its rock and grade (≈ 218k blocks, under a second)
export function makeSiteCBlockCsv() {
  const B = SC.BOX, { dx, dy, dz } = SITE_C_BLOCK, O = SC.ORIGIN, parts = ['XC,YC,ZC,AU,SG,UNIT\n'];
  for (let x = B.x0 + dx / 2; x < B.x1; x += dx) {
    const rows = [];
    for (let y = B.y0 + dy / 2; y < B.y1; y += dy) {
      const t = SC.topo(x, y);                                 // once per column: it's the costly part
      for (let z = B.z0 + dz / 2; z < t; z += dz) {
        let u = SC.lithT(x, y, z, t); if (!u) continue;
        if (u === 1) u = SC.lithT(x, y, z - 12, t);            // the regolith (8–12 m) is thinner than a block: the bedrock
        const s = scShort(u);
        rows.push(`${x + O.E},${y + O.N},${z},${SC.gradeU(x, y, z, u).toFixed(3)},${SITE_C_SG[s]},${s}`);
      }
    }
    parts.push(rows.join('\n') + '\n');
  }
  return new Blob(parts, { type: 'text/csv' });
}
// the drilling: three fences across the fold hinge, seven holes each at −60° toward 310°; 2 m assays from the
// SAME model the blocks are, with a lognormal sampling scatter (a drillhole is a sample, the block an estimate)
export function makeSiteCDrillholes() {
  const O = SC.ORIGIN, rnd = mulberry32(2026);
  const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const collar = ['HOLEID,X,Y,Z,EOH'], survey = ['HOLEID,DEPTH,AZ,DIP'], assay = ['HOLEID,FROM,TO,AU,UNIT'];
  for (const h of SC.drillholes()) {
    let eoh = 0;
    for (let d = 0; d + 2 <= h.length; d += 2) {
      const [x, y, z] = h.at(d + 1), u = SC.lith(x, y, z);
      if (!u) continue;                                        // (never, below the collar — but a hole is no place to guess)
      const au = SC.gradeU(x, y, z, u) * Math.exp(0.35 * gauss() - 0.06);
      assay.push(`${h.id},${d},${d + 2},${au.toFixed(3)},${scShort(u)}`);
      eoh = d + 2;
    }
    collar.push(`${h.id},${(h.x + O.E).toFixed(1)},${(h.y + O.N).toFixed(1)},${h.z.toFixed(1)},${eoh}`);
    survey.push(`${h.id},0,${h.azimuth},${h.dip}`, `${h.id},${eoh},${h.azimuth},${h.dip}`);
  }
  return {
    collar: new File([collar.join('\n') + '\n'], 'sitec_collars.csv'),
    survey: new File([survey.join('\n') + '\n'], 'sitec_survey.csv'),
    intervals: new File([assay.join('\n') + '\n'], 'sitec_assay.csv'),
  };
}
// the topography, on a 10 m lattice over the mapped ground
function makeSiteCTopo() {
  const B = SC.BOX, O = SC.ORIGIN, dx = 10;
  const nx = Math.round((B.x1 - B.x0) / dx) + 1, ny = Math.round((B.y1 - B.y0) / dx) + 1, data = new Float32Array(nx * ny);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) data[r * nx + c] = SC.topo(B.x0 + c * dx, B.y1 - r * dx);
  return { nx, ny, dx, dy: dx, x0: B.x0 + O.E, y0: B.y1 + O.N, data, nodata: -9999 };
}
export async function openSiteC() {
  $('#empty').style.display = 'none';
  $('#meta').textContent = 'Site C — building the block model…';
  await new Promise((r) => setTimeout(r));
  await openBlob(makeSiteCBlockCsv(), 'site-c.csv', 'replace');
  const bm = activeLayer();
  if (bm) {
    bm.label = 'Site C — blocks';
    // coloured by rock, in the map's own palette (the cover's legend)
    try {
      await setLayerColorBy(bm, colorSelFor(bm, 'UNIT'));
      bm.catLegend = { col: 'UNIT', entries: SC.UNITS.filter((u) => u.short).map((u) => ({ label: u.name, values: [u.short], color: u.color })), otherColor: '#555a5f' };
      applyCatLegend(bm, true);
    } catch { /* stays grade-coloured */ }
  }
  $('#meta').textContent = 'Site C — desurveying the drill fences…';
  let dh = null;
  try { await openDrillholeLayer(makeSiteCDrillholes(), { radius: 5 }, 'add'); dh = activeLayer(); if (dh) dh.label = 'Site C — drillholes'; }
  catch (e) { $('#meta').textContent = `Site C drillholes failed — ${e.message}`; }
  try {
    const got = await openBlob(new Blob([writeEsriAsc(makeSiteCTopo())]), 'site-c-topo.asc', 'add');
    const g = layerById(got);
    if (g) await reopenAs(g, 'surface');
    const L = layerById(followLayer(got));
    if (L) { L.label = 'topography'; L.opacity = 0.35; renderer.setLayerOpacity(L.id, 0.35); }
  } catch (e) { $('#meta').textContent = `Site C topography — ${e.message}`; }
  // cut like plate B of the cover: vertical, striking 130° (across the fold), through the middle drill fence;
  // keep the NE side, so the view from the SW looks up the plunge onto the cut face
  const C = SC.FRAME.centre, nrm = [-Math.sin(40 * Math.PI / 180), -Math.cos(40 * Math.PI / 180), 0];
  applySection({ mode: 'custom', dipDir: 40, dip: 90, clip: 'behind', at: nrm[0] * (C.x + SC.ORIGIN.E) + nrm[1] * (C.y + SC.ORIGIN.N) });
  if (dh) renderer.setLayerSectioned(dh.id, false);
  $('#btnFit').click();
  try { setCameraWorld({ look: 40, elevation: 28 }); } catch { /* the fitted view stands */ }   // from the SW, up the plunge, onto the cut
  try { S.views = S.views.filter((v) => v.name !== 'Site C — section B–B′').concat([{ name: 'Site C — section B–B′', camera: captureCamera(), section: captureSection() }]); } catch { /* best-effort */ }
  if (bm) {
    setActiveLayer(bm.id);
    try {
      openGradeTonnage(bm, { run: true, cfg: { series: [{ layer: bm.name, col: 'AU', unit: 'g/t', weight: 'SG' }], gradeUnit: 'g/t', densUnit: 't/m3', nCut: 40 } });
      const gtWin = [...document.querySelectorAll('.fwin')].pop();
      if (gtWin) { gtWin.style.left = Math.max(0, innerWidth - gtWin.offsetWidth - 14) + 'px'; gtWin.style.top = '70px'; }
    } catch { /* window optional */ }
  }
  $('#meta').textContent = 'Site C — gold in a folded banded iron formation: blocks by rock, the drill fences, the topography, cut across the fold, with grade–tonnage. The manual’s cover is drawn from this same model.';
}
