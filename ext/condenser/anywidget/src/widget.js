// @gcu/condenser — the anywidget (Jupyter) front half. Glue only: it decodes
// the packed columnar payload, feeds each layer through the engine's chunk
// builders, and drives one progressive render loop per widget instance. All
// the rendering intelligence (Morton order, prefix LOD, box impostors, capsule
// impostors, EDL, true sections, the ID-buffer pick) is @gcu/condenser/core,
// unchanged — the SAME engine micro ships, so a notebook and the desktop tool
// agree by construction. Drillholes desurvey through @gcu/drillhole, also the
// same code, so a hole lands in the same place in both.
//
// anywidget contract: default-export an object with render({model, el}),
// returning a cleanup function. `_payload` is one atomic Bytes blob holding
// EVERY layer against ONE shared frame; `_styles` is a per-layer style dict.

import {
  createRenderer, createEdl, createOrbitCamera, attachOrbitInput,
  createChunkBuilder, createBlockChunkBuilder, createStickChunkBuilder,
  makeBlockGrid, buildMeshChunk, buildHeightfieldMesh, rampPixels, categoryPalettePixels, mat4Inverse,
  openBlockModel, openDmModel, openLas, openPly, openDrillholes, documentFrame,
  sniffDelimited, mapColumns, peekDmColumns, readDelimited,
} from '../../index.js';
import { dhDesurveySamples } from '../../../drillhole/src/samples.js';
import { openParquetBlocks } from './parquet-blocks.js';
import { createToolbar } from './toolbar.js';

// ── ramp presets. rampPixels' default is the viridis-ish walk; these are the
// few a geologist reaches for. Kept here (not in the engine) because they are
// a PRESENTATION choice — micro has its own richer set in its own UI. ──
const RAMPS = {
  viridis: null,                                           // the engine default
  magma: [[0, 0, 4], [80, 18, 123], [182, 54, 121], [252, 137, 97], [252, 253, 191]],
  turbo: [[48, 18, 59], [28, 156, 220], [96, 252, 100], [249, 190, 60], [122, 4, 3]],
  grays: [[20, 20, 20], [90, 90, 90], [150, 150, 150], [205, 205, 205], [250, 250, 250]],
  spectral: [[94, 79, 162], [102, 194, 165], [255, 255, 191], [253, 174, 97], [158, 1, 66]],
  fire: [[10, 5, 40], [120, 20, 90], [220, 80, 40], [250, 180, 50], [255, 250, 200]],
};
RAMPS.greys = RAMPS.grays;    // matplotlib spells it 'Greys'; don't punish the muscle memory

const TYPES = { f64: Float64Array, f32: Float32Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array };

// ── the wire format (mirrors gcu_condenser/__init__.py's _pack) ──
//   'CDNS' | u32 version | u32 headerLen | header JSON (utf-8) | pad | body
// Column offsets are RELATIVE TO THE BODY START, which both sides derive as
// (12 + headerLen) rounded up to 8 — self-describing without the offsets
// depending on the header's own length. ONE blob keeps a data change ATOMIC.
function decodePayload(raw) {
  if (!raw) return null;
  const buf = raw instanceof ArrayBuffer ? raw : (raw.buffer || raw);
  const base = raw.byteOffset || 0;
  const len = raw.byteLength != null ? raw.byteLength : (buf ? buf.byteLength : 0);
  if (!buf || len < 12) return null;
  const dv = new DataView(buf, base, len);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'CDNS') return null;
  const headerLen = dv.getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, base + 12, headerLen)));
  const bodyStart = (12 + headerLen + 7) & ~7;
  const all = {};
  for (const [name, c] of Object.entries(head.cols || {})) {
    const T = TYPES[c.type];
    if (T) all[name] = new T(buf, base + bodyStart + c.off, c.len);
  }
  const layers = (head.layers || []).map((L) => {
    const cols = {};
    for (const [name, key] of Object.entries(L.cols || {})) if (all[key]) cols[name] = all[key];
    return { ...L, cols };
  });
  return { frame: head.frame, frame_auto: !!head.frame_auto, layers };
}

// ── via='files': a Blob-shaped window onto jupyter-server's /files/ endpoint,
// which serves byte ranges on the session cookie — so the engine's own file
// providers (CSV/.dm/LAS/PLY, the same code micro ships) read straight from
// the notebook's folder with ZERO kernel involvement. Only the Blob surface
// the io layer actually touches is implemented: size/slice/arrayBuffer/text/
// stream. A server that ignores Range (plain static hosting) still works —
// the 200 fallback skips to the window.
class RemoteBlob {
  constructor(url, start, end) { this.url = url; this._start = start; this._end = end; }
  get size() { return this._end - this._start; }
  slice(a = 0, b = this.size) {
    const n = this.size;
    const s = Math.min(n, Math.max(0, a < 0 ? n + a : a));
    const e = Math.min(n, Math.max(s, b < 0 ? n + b : b));
    return new RemoteBlob(this.url, this._start + s, this._start + e);
  }
  async arrayBuffer() {
    if (this.size <= 0) return new ArrayBuffer(0);
    const res = await fetch(this.url, { headers: { Range: `bytes=${this._start}-${this._end - 1}` } });
    if (!res.ok) throw new Error(`files: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (res.status === 206) return buf;
    return buf.slice(this._start, this._end);              // Range ignored → cut the window out
  }
  async text() { return new TextDecoder().decode(await this.arrayBuffer()); }
  stream() {
    const { url, _start, _end } = this;
    let reader = null, skip = 0, left = _end - _start;
    return new ReadableStream({
      async start() {
        const res = await fetch(url, { headers: { Range: `bytes=${_start}-${_end - 1}` } });
        if (!res.ok || !res.body) throw new Error(`files: HTTP ${res.status}`);
        if (res.status !== 206) skip = _start;             // Range ignored → skip up to the window
        reader = res.body.getReader();
      },
      async pull(ctrl) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || left <= 0) { ctrl.close(); return; }
          let v = value;
          if (skip > 0) {
            if (v.length <= skip) { skip -= v.length; continue; }
            v = v.subarray(skip); skip = 0;
          }
          if (v.length > left) v = v.subarray(0, left);
          left -= v.length;
          ctrl.enqueue(v);
          return;
        }
      },
      cancel() { if (reader) reader.cancel().catch(() => {}); },
    });
  }
}

// probe the /files/ candidates (and a hub-style base prefix derived from the
// page URL) until one answers a byte range; null when none does
async function resolveFilesBlob(file) {
  const prefixes = ['/files/'];
  const m = (typeof document !== 'undefined' ? document.location.pathname : '').match(/^(.+?)\/(lab|notebooks|voila|tree)\b/);
  if (m && m[1]) prefixes.push(`${m[1]}/files/`);
  for (const cand of file.candidates || []) {
    for (const pre of prefixes) {
      const url = pre + cand.split('/').map(encodeURIComponent).join('/');
      try {
        const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
        if (!res.ok) continue;
        let size = file.size || 0;
        const cr = res.headers.get('Content-Range');
        if (cr) { const mm = cr.match(/\/(\d+)\s*$/); if (mm) size = +mm[1]; }
        else if (res.status === 200) {
          const cl = +res.headers.get('Content-Length') || 0;
          if (cl > 1) size = cl;                           // the server sent the whole file
        }
        if (size > 0) return new RemoteBlob(url, 0, size);
      } catch { /* next candidate */ }
    }
  }
  return null;
}

// which engine color mode a `color` choice means, per element kind. The engine
// numbers differ by pipeline (points: 1 = intensity, blocks/sticks: 1 = grade),
// so the widget speaks names and translates here.
function modeOf(color, kind, cols) {
  if (color === 'value' && (cols.value || cols.value_u16)) return 1;
  if (color === 'category' && cols.cat) return 2;
  if (color === 'rgb' && cols.rgb && kind === 'points') return 3;
  if (color === 'flat') return kind === 'points' ? 0 : 3;  // blocks/sticks: 3 = solid
  return 0;                                                // 'z' (elevation)
}

// the section trait → the engine's frame-local plane. `position` is a WORLD
// coordinate along the normal (that is what a geologist types), so the frame
// origin comes off it here.
function normalOf(sec) {
  let n = sec.normal;
  if (!n) {
    const ax = sec.axis;
    if (!ax) return null;
    n = ax === 'x' ? [1, 0, 0] : ax === 'y' ? [0, 1, 0] : [0, 0, 1];
  }
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / L, n[1] / L, n[2] / L];
}
function sectionOf(sec, origin) {
  if (!sec) return null;
  const n = normalOf(sec);
  if (!n) return null;
  const d = (+sec.position || 0) - (n[0] * origin[0] + n[1] * origin[1] + n[2] * origin[2]);
  const half = Math.max(0.01, (+sec.thickness || 10) / 2);
  return { on: true, n, d, half, d0: d, clip: 'slab', traceHalf: half };
}

// ── drillholes: three tables → desurveyed capsule segments ──
// The interval FROM and TO depths are located as two point-samples on the
// desurveyed trace (arc-correct via positionAt), then paired back into a
// segment keyed by source row — the same construction condenser's own file
// provider uses, so notebook and micro place a hole identically.
function drillholeSegments(head, cols) {
  const nC = cols.c_bhid.length, nS = cols.s_bhid.length, n = cols.i_bhid.length;
  const collars = new Array(nC);
  for (let i = 0; i < nC; i++) {
    collars[i] = { bhid: String(cols.c_bhid[i]), x: cols.c_x[i], y: cols.c_y[i], z: cols.c_z[i] };
    if (cols.c_eoh) collars[i].eoh = cols.c_eoh[i];
  }
  const surveys = new Array(nS);
  for (let i = 0; i < nS; i++) surveys[i] = { bhid: String(cols.s_bhid[i]), depth: cols.s_depth[i], az: cols.s_az[i], dip: cols.s_dip[i] };

  const bhid = new Array(2 * n), depth = new Float64Array(2 * n);
  const rowIdx = new Float64Array(2 * n), endIdx = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    const hb = String(cols.i_bhid[i]);
    bhid[2 * i] = hb; bhid[2 * i + 1] = hb;
    depth[2 * i] = cols.i_from[i]; depth[2 * i + 1] = cols.i_to[i];
    rowIdx[2 * i] = i; rowIdx[2 * i + 1] = i;
    endIdx[2 * i] = 0; endIdx[2 * i + 1] = 1;
  }
  const ds = dhDesurveySamples(
    { collars, surveys, samples: { bhid, depth, cols: [{ name: '__row', values: rowIdx }, { name: '__end', values: endIdx }] } },
    { method: head.method || 'minimumCurvature', dipConvention: head.dip_convention || 'auto' },
  );

  const endA = new Map(), endB = new Map();                // src row → [x,y,z]
  for (const row of ds.rows) (row[6] | 0) === 0 ? endA.set(row[5] | 0, [row[1], row[2], row[3]]) : endB.set(row[5] | 0, [row[1], row[2], row[3]]);
  const placed = [];
  for (const src of endA.keys()) if (endB.has(src)) placed.push(src);
  placed.sort((a, b) => a - b);
  const k = placed.length;
  const out = {
    count: k,
    ax: new Float64Array(k), ay: new Float64Array(k), az: new Float64Array(k),
    bx: new Float64Array(k), by: new Float64Array(k), bz: new Float64Array(k),
    x: new Float64Array(k), y: new Float64Array(k), z: new Float64Array(k),
    chan: new Float64Array(k), cat: cols.cat ? new Uint8Array(k) : null,
    recIdx: new Uint32Array(k),
  };
  for (let i = 0; i < k; i++) {
    const s = placed[i], A = endA.get(s), B = endB.get(s);
    out.ax[i] = A[0]; out.ay[i] = A[1]; out.az[i] = A[2];
    out.bx[i] = B[0]; out.by[i] = B[1]; out.bz[i] = B[2];
    out.x[i] = (A[0] + B[0]) / 2; out.y[i] = (A[1] + B[1]) / 2; out.z[i] = (A[2] + B[2]) / 2;
    out.chan[i] = cols.value && Number.isFinite(cols.value[s]) ? cols.value[s] : 0;
    if (out.cat) out.cat[i] = cols.cat[s];
    out.recIdx[i] = s;                                     // the INTERVAL row — the pick's join key
  }
  return out;
}

const fmtN = (v) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a >= 1e5 || (a < 0.01 && a > 0) ? v.toExponential(2) : String(Math.round(v * 100) / 100);
};

// ── the WORKER half: this same bundle, booted as a module worker (from
// import.meta.url, so nothing extra ships). Chunk building — Morton keys,
// radix sort, quantize, shuffle — runs here while streaming, so a multi-
// million-row cd.open never stutters the notebook; the GPU upload stays with
// the page. The main side mirrors every push into resident columns first, so
// a worker failure just rebuilds inline from those — the fallback is free. ──
if (typeof document === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  let wb = null;
  const ship = (c) => {
    const transfers = new Set();
    for (const k in c) { const v = c[k]; if (v && ArrayBuffer.isView(v)) transfers.add(v.buffer); }
    self.postMessage({ chunk: c }, [...transfers]);
  };
  self.onmessage = (e) => {
    const m = e.data;
    try {
      if (m.init) {
        const frame = { origin: m.init.frameOrigin, crs: null, units: 'm' };
        wb = m.init.kind === 'blocks'
          ? createBlockChunkBuilder({
            frame, chunkSize: 1 << 18, seed: 1,
            grid: makeBlockGrid(m.init.axes.map(([origin, pitch, count]) => ({ origin, pitch, count })), frame),
            dimPalette: m.init.dimPalette || null,
            onChunk: ship,
          })
          : createChunkBuilder({ frame, chunkSize: 1 << 19, seed: 1, onChunk: ship });
      } else if (m.push) {
        wb.push(m.push);
        wb.flush();                                        // progressive at message granularity
      } else if (m.eof) {
        const doc = wb.flush();
        self.postMessage({ done: {
          count: doc.count, bboxLocal: [...doc.bboxLocal],
          chanRange: doc.chanRange ? [...doc.chanRange] : null,
        } });
      }
    } catch (err) {
      self.postMessage({ err: String((err && err.message) || err) });
    }
  };
}

// anywidget wants a DEFAULT export; @gcu/build emits named exports only (its
// rename-on-collision pass needs names). So this is named, and build.js appends
// the one-line `export default { render }` footer to the bundle.
export function render({ model, el }) {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:100%;background:#121212;border-radius:3px;overflow:hidden;';
  // right-drag PANS, so JupyterLab's own context menu must stay out of the way.
  // This attribute is the supported hook: JupyterLab's handler does
  // `el.closest('[data-jp-suppress-context-menu]')` and stands down if it hits.
  host.setAttribute('data-jp-suppress-context-menu', 'true');
  host.addEventListener('contextmenu', (e) => e.preventDefault());
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  host.appendChild(canvas);
  // figure chrome + hole labels: a 2D overlay redrawn with every frame and
  // COMPOSITED into snapshots (DOM chrome would be lost by toDataURL)
  const deco = document.createElement('canvas');
  deco.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
  host.appendChild(deco);
  const hud = document.createElement('div');
  hud.className = 'cdhud';
  hud.style.cssText = 'position:absolute;left:6px;bottom:5px;font:11px ui-monospace,Menlo,Consolas,monospace;color:#8b8b8b;pointer-events:none;text-shadow:0 1px 2px #000;z-index:1;';
  host.appendChild(hud);
  el.appendChild(host);

  let renderer = null, edl = null, cam = null, detach = null, raf = 0, ro = null, tb = null;
  let payload = null, disposed = false, needFit = false, converged = false;
  let docBbox = null;
  let streams = null, streamEpoch = '';                    // cd.open(): layer → stream state, this view's epoch
  let fileQueue = Promise.resolve();                       // via='files' layers build sequentially (frame adoption)
  let fileMsg = null;                                      // a files-mode failure, pinned on the hud
  let userCam = false;                                     // the user framed a shot — auto-fit must not steal it
  const kinds = [];

  try {
    renderer = createRenderer(canvas, { background: [0.07, 0.07, 0.07, 1] });
    edl = createEdl(renderer.gl);
    cam = createOrbitCamera();
  } catch (e) {                                            // no WebGL2 (headless CI, locked-down VM)
    host.style.height = '80px';
    hud.style.cssText += 'position:static;padding:10px;color:#d07a5c;';
    hud.textContent = `condenser: ${e.message}`;
    return () => { el.innerHTML = ''; };
  }

  const styles = () => model.get('_styles') || [];
  const styleAt = (i) => styles()[i] || {};
  const viewOpts = () => {                                 // point size / points-view are VIEW-wide in the engine
    let pointPx = 2.5, asPoints = false;
    for (const s of styles()) if (s.visible !== false) { pointPx = Math.max(pointPx, s.point_size || 0); asPoints = asPoints || !!s.as_points; }
    return { pointPx, asPoints };
  };

  // ── the decorations overlay: hole labels + north arrow + scale bar. Redrawn
  // with every frame (2D, cheap) and COMPOSITED into snapshots. Coordinates
  // are frame-local, projected through the camera's viewProj — which already
  // carries the z-exaggeration, so labels track the stretched display. ──
  const drawOverlay = (w, h, dpr) => {
    if (deco.width !== w || deco.height !== h) { deco.width = w; deco.height = h; }
    const g = deco.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!payload) return;
    const W = w / dpr, H = h / dpr;
    g.save();
    g.scale(dpr, dpr);
    const vp = cam.state.viewProj;
    const proj = (X, Y, Z) => {
      const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
      if (cw <= 1e-9) return null;
      return [((vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12]) / cw * 0.5 + 0.5) * W,
        (0.5 - (vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13]) / cw * 0.5) * H];
    };
    const o = payload.frame;
    const halo = (text, x, y) => {
      g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 3; g.lineJoin = 'round';
      g.strokeText(text, x, y);
      g.fillText(text, x, y);
    };

    // hole labels (labels=True on a drillhole layer): BHIDs at the collars
    g.font = '10px ui-monospace,Menlo,Consolas,monospace';
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillStyle = '#e4e4e4';
    styles().forEach((s, i) => {
      const L = payload.layers[i];
      if (!L || L.kind !== 'drillholes' || !s.labels || s.visible === false || !L._collars) return;
      let drawn2 = 0;
      for (const c of L._collars) {
        if (drawn2 >= 400) break;                          // a 10k-hole campaign is a texture, not labels
        const p = proj(c.x - o[0], c.y - o[1], c.z - o[2]);
        if (!p || p[0] < -20 || p[0] > W + 20 || p[1] < -10 || p[1] > H + 10) continue;
        halo(c.name, p[0], p[1] - 4);
        g.fillRect(p[0] - 1, p[1] - 2, 2, 2);              // the collar tick
        drawn2++;
      }
    });

    if (model.get('decorations') === false) { g.restore(); return; }
    // scale at the CAMERA TARGET depth: unproject a 100-px screen step on the
    // plane through the target, z divided back by zExag → REAL meters
    const t = cam.state.target;
    const inv = mat4Inverse(vp);
    const tp = proj(t[0], t[1], t[2]);
    if (inv && tp) {
      const cwT = vp[3] * t[0] + vp[7] * t[1] + vp[11] * t[2] + vp[15];
      const ndcZ = (vp[2] * t[0] + vp[6] * t[1] + vp[10] * t[2] + vp[14]) / cwT;
      const un = (sx, sy) => {
        const nx = (sx / W) * 2 - 1, ny = 1 - (sy / H) * 2;
        const x = inv[0] * nx + inv[4] * ny + inv[8] * ndcZ + inv[12];
        const y = inv[1] * nx + inv[5] * ny + inv[9] * ndcZ + inv[13];
        const z = inv[2] * nx + inv[6] * ny + inv[10] * ndcZ + inv[14];
        const w2 = inv[3] * nx + inv[7] * ny + inv[11] * ndcZ + inv[15];
        return [x / w2, y / w2, z / w2];
      };
      const p1 = un(tp[0], tp[1]), p2 = un(tp[0] + 100, tp[1]);
      const ze = cam.state.zExag || 1;
      const m100 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], (p2[2] - p1[2]) / ze);
      if (m100 > 1e-9 && Number.isFinite(m100)) {
        const pxPerM = 100 / m100;
        let len = Math.pow(10, Math.floor(Math.log10(120 / pxPerM)));
        for (const k of [5, 2, 1]) if (len * k * pxPerM <= 160) { len *= k; break; }
        const px = len * pxPerM;
        const label = len >= 1000 ? `${len / 1000} km` : `${len} m`;
        const bx0 = W / 2 - px / 2, by0 = H - 14;
        for (const [col, lw] of [['rgba(0,0,0,.7)', 4], ['#d8d8d8', 1.6]]) {
          g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'butt';
          g.beginPath();
          g.moveTo(bx0, by0); g.lineTo(bx0 + px, by0);
          g.moveTo(bx0, by0 - 4); g.lineTo(bx0, by0 + 4);
          g.moveTo(bx0 + px, by0 - 4); g.lineTo(bx0 + px, by0 + 4);
          g.stroke();
        }
        g.fillStyle = '#cfcfcf';
        halo(label, W / 2, by0 - 5);

        // north arrow, left of the bar — world +Y projected at the target.
        // Looking ALONG north the projection collapses: fade it rather than spin
        const np = proj(t[0], t[1] + m100, t[2]);
        if (np) {
          const dxn = np[0] - tp[0], dyn = np[1] - tp[1];
          const ln = Math.hypot(dxn, dyn);
          const alpha = Math.max(0, Math.min(1, ln / 40));
          if (alpha > 0.05) {
            const ang = Math.atan2(dyn, dxn);
            const cxN = bx0 - 30, cyN = by0 - 6;
            g.globalAlpha = alpha;
            g.save();
            g.translate(cxN, cyN); g.rotate(ang);
            g.beginPath();
            g.moveTo(11, 0); g.lineTo(-6, 4.5); g.lineTo(-3, 0); g.lineTo(-6, -4.5); g.closePath();
            g.fillStyle = '#d8d8d8'; g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 2;
            g.stroke(); g.fill();
            g.restore();
            g.fillStyle = '#d8d8d8';
            halo('N', cxN + Math.cos(ang) * 19, cyN + Math.sin(ang) * 19 + 4);
            g.globalAlpha = 1;
          }
        }
      }
    }
    g.restore();
  };

  const draw = () => {
    raf = 0;
    if (disposed) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; renderer.invalidate(); }
    cam.setAspect(w / h);
    if (needFit && docBbox) { cam.fit(docBbox); needFit = false; }

    const layerOpts = {};
    styles().forEach((s, i) => {
      const cols = payload && payload.layers[i] ? payload.layers[i].cols : {};
      layerOpts[i] = { colorMode: modeOf(s.color, kinds[i], cols), clip: s.clip && s.clip.length === 2 ? s.clip : null };
    });
    const vo = viewOpts();
    const opts = {
      budget: model.get('budget') || 3_000_000,
      pointPx: vo.pointPx, blocksAsPoints: vo.asPoints, blockEdges: false,
      section: sectionOf(model.get('section'), (payload && payload.frame) || [0, 0, 0]),
      clip: null, layerOpts,
    };
    const r = edl.render(w, h, cam, () => renderer.draw(cam, opts),
      { enabled: model.get('edl') !== false, strength: model.get('edl_strength') != null ? model.get('edl_strength') : 1.0 });
    converged = r.converged;
    if (payload) {
      const tot = renderer.elementCount, acc = renderer.accumulated;
      const n = payload.layers.length;
      const what = n === 1
        ? (kinds[0] === 'blocks' ? 'blocks' : kinds[0] === 'drillholes' ? 'intervals'
          : kinds[0] === 'mesh' || kinds[0] === 'surface' ? 'triangles' : 'points')
        : `elements · ${n} layers`;
      hud.textContent = fileMsg || (converged ? `${tot.toLocaleString()} ${what}` : `${tot.toLocaleString()} · ${Math.round((100 * acc) / (tot || 1))}%`);
    }
    drawOverlay(w, h, dpr);
    pushCamera();                                          // debounced by value — idle frames are free
    if (!converged) schedule();
  };
  const schedule = () => { if (!raf && !disposed) raf = requestAnimationFrame(draw); };
  const invalidate = () => { renderer.invalidate(); schedule(); };

  // ── load: payload → chunk builders → GPU, one engine layer per data layer ──
  const load = () => {
    renderer.clearChunks();
    payload = null; docBbox = null; kinds.length = 0;
    if (streams) for (const k in streams) { const stw = streams[k] && streams[k].worker; if (stw) try { stw.terminate(); } catch { /* gone */ } }
    streams = null; streamEpoch = Math.random().toString(36).slice(2);
    fileQueue = Promise.resolve(); fileMsg = null;
    const p = decodePayload(model.get('_payload'));
    if (!p || !p.layers.length) { hud.textContent = 'no data'; if (tb) { tb.showPick(null); tb.syncLegend(null); } schedule(); return; }
    payload = p;
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

    p.layers.forEach((L, i) => {
      kinds[i] = L.kind;
      const lb = buildLayer(L, i);
      if (lb) {
        for (let a = 0; a < 3; a++) {
          if (lb[a] < bb[a]) bb[a] = lb[a];
          if (lb[a + 3] > bb[a + 3]) bb[a + 3] = lb[a + 3];
        }
      }
    });

    if (Number.isFinite(bb[0])) {                          // files-only views have no bbox YET
      docBbox = Float64Array.from(bb);
      renderer.setDocBbox(docBbox);
      if (!userCam) needFit = true;                        // never steal a framed shot on a data change
    }
    applyStyles();
    if (tb) { tb.showPick(null); syncChrome(); }
    invalidate();
    if (streams) model.send({ type: 'ready', epoch: streamEpoch });
  };

  // merge a layer's local bbox as it becomes known (files-mode discovery)
  const mergeBbox = (lb) => {
    if (!docBbox) docBbox = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    for (let a = 0; a < 3; a++) {
      if (lb[a] < docBbox[a]) docBbox[a] = lb[a];
      if (lb[a + 3] > docBbox[a + 3]) docBbox[a + 3] = lb[a + 3];
    }
    if (Number.isFinite(docBbox[0])) {
      renderer.setDocBbox(docBbox);
      if (!userCam) needFit = true;
    }
  };

  // ── via='files': discover + stream a file BROWSER-SIDE through the engine's
  // providers — the kernel never reads a byte. Sequential across layers: the
  // FIRST discovery may set the shared frame (payload.frame_auto). ──
  // the shared epilogue: a files layer finished discovering/streaming — frame
  // bookkeeping was done by the caller; here the styles, chrome, and the
  // kernel's view of what the browser found.
  const finishFileLayer = (L, i, doc) => {
    if (doc && doc.bboxLocal && Number.isFinite(doc.bboxLocal[0])) mergeBbox(doc.bboxLocal);
    applyStyles();
    if (tb) syncChrome();
    invalidate();
    try {                                                  // the kernel learns what the browser found
      const info = { ...(model.get('_file_info') || {}) };
      info[i] = { count: L.count, value_range: L.value_range || null,
        cat_labels: L.cat_labels || null, cat_n: L.cat_n || null };
      model.set('_file_info', info);
      model.save_changes();
    } catch { /* a detached test model */ }
  };
  const adoptFrame = (header) => {                         // a files-only view takes the first real frame
    if (payload.frame_auto) {
      payload.frame = documentFrame(header).origin;
      payload.frame_auto = false;
    }
    const frame = { origin: payload.frame, crs: null, units: 'm' };
    if (header.bbox && Number.isFinite(header.bbox.min[0])) {
      mergeBbox(Float64Array.of(
        header.bbox.min[0] - frame.origin[0], header.bbox.min[1] - frame.origin[1], header.bbox.min[2] - frame.origin[2],
        header.bbox.max[0] - frame.origin[0], header.bbox.max[1] - frame.origin[1], header.bbox.max[2] - frame.origin[2]));
    }
    return frame;
  };

  const buildFileLayer = async (L, i) => {
    const epoch = streamEpoch;
    try {
      // drillholes: THREE files (collar / survey / intervals) → desurveyed
      // capsules, the provider's own column sniff + optional value/category names
      if (L.file.drillholes) {
        const fd = L.file.drillholes;
        const [cb, sb, ib] = await Promise.all([resolveFilesBlob(fd.collar), resolveFilesBlob(fd.survey), resolveFilesBlob(fd.intervals)]);
        if (epoch !== streamEpoch || disposed) return;
        if (!cb || !sb || !ib) {
          fileMsg = `${L.file.name}: /files unreachable — jupyter-server serves it; elsewhere stream via the kernel`;
          schedule();
          return;
        }
        const opts = { method: fd.method || 'minimumCurvature', dipConvention: fd.dip_convention || 'auto' };
        const fm0 = L.file.map || null;
        if (fm0 && (fm0.value || fm0.category)) {          // value/category BY NAME → interval column indices
          const tIv = await readDelimited(ib.slice(0, Math.min(65536, ib.size)));
          const idx = (nm) => tIv.columns.findIndex((h2) => h2.trim() === nm);
          if (fm0.value) { const k2 = idx(fm0.value); if (k2 >= 0) opts.chan = k2; }
          if (fm0.category) { const k2 = idx(fm0.category); if (k2 >= 0) opts.cat = k2; }
        }
        const { header, streamChunks, recordPosition } = await openDrillholes({ collar: cb, survey: sb, intervals: ib }, opts);
        if (epoch !== streamEpoch || disposed) return;
        const frame = adoptFrame(header);
        kinds[i] = 'drillholes';
        const b = createStickChunkBuilder({ frame, chunkSize: 1 << 16, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        for await (const rc of streamChunks()) {
          if (epoch !== streamEpoch || disposed) return;
          b.push(rc);
        }
        const doc = b.flush();
        if (header.categories) { L.cat_labels = header.categories; L.cat_n = header.categories.length; renderer.setCategories(L.cat_n); }
        L.count = header.count;
        if (header.chanRange && Number.isFinite(header.chanRange[0])) L.value_range = header.chanRange;
        L._posAt = (r) => recordPosition(r);               // measure / readout off the desurveyed midpoints
        finishFileLayer(L, i, doc);
        return;
      }

      const blob = await resolveFilesBlob(L.file);
      if (epoch !== streamEpoch || disposed) return;
      if (!blob) {
        fileMsg = `${L.file.name}: /files unreachable — jupyter-server serves it; elsewhere stream via the kernel`;
        schedule();
        return;
      }
      const ext2 = (L.file.name.match(/\.([a-z0-9]+)$/i) || [0, ''])[1].toLowerCase();
      const fm = L.file.map || null;
      let opened;
      if (ext2 === 'parquet' || ext2 === 'pq') {
        opened = await openParquetBlocks(blob, { map: fm });
      } else if (ext2 === 'dm') {
        let mapping = null;
        if (fm && (fm.value || fm.category)) {             // .dm maps chan/cat by field name
          const names = await peekDmColumns(blob);
          if (names) {
            mapping = {};
            if (fm.value) { const k2 = names.indexOf(fm.value); if (k2 >= 0) mapping.chan = k2; }
            if (fm.category) { const k2 = names.indexOf(fm.category); if (k2 >= 0) mapping.cat = k2; }
          }
        }
        opened = await openDmModel(blob, { mapping });
      } else if (ext2 === 'las') {
        opened = await openLas(blob);
      } else if (ext2 === 'ply') {
        opened = await openPly(blob);
      } else {
        let mapping = null;
        if (fm) {                                          // delimited: names → sniffed column indices
          const sniff = sniffDelimited(await blob.slice(0, Math.min(65536, blob.size)).text());
          if (sniff.header) {
            const idx = (nm) => (nm == null ? -1 : sniff.header.findIndex((h2) => h2.trim() === nm));
            mapping = { ...(mapColumns(sniff.header) || {}) };
            for (const [k2, mk] of [['x', 'x'], ['y', 'y'], ['z', 'z'], ['chan', 'value'], ['cat', 'category']]) {
              const k3 = idx(fm[mk]);
              if (k3 >= 0) mapping[k2] = k3;
            }
            if (!(mapping.x >= 0 && mapping.y >= 0 && mapping.z >= 0)) mapping = null;
          }
        }
        opened = await openBlockModel(blob, { mapping });
      }
      if (epoch !== streamEpoch || disposed) return;
      const { header, streamChunks } = opened;
      const isBlocks = !!header.grid;
      if (!isBlocks && !(ext2 === 'las' || ext2 === 'ply')) {
        fileMsg = `${L.file.name}: not a regular block lattice — open resident, or as points via the kernel`;
        schedule();
        return;
      }
      const frame = adoptFrame(header);
      let b;
      if (isBlocks) {
        kinds[i] = 'blocks';
        const grid = makeBlockGrid([header.grid.x, header.grid.y, header.grid.z], frame);
        b = createBlockChunkBuilder({
          frame, grid, chunkSize: 1 << 18, seed: 1,
          dimPalette: header.dimPalette || null,
          onChunk: (c) => renderer.addChunk(c, 'base', i),
        });
        if (header.categories) {
          L.cat_labels = header.categories;
          L.cat_n = header.categories.length;
          renderer.setCategories(L.cat_n);
        }
      } else {
        kinds[i] = 'points';
        b = createChunkBuilder({ frame, chunkSize: 1 << 19, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        L.cols.value_u16 = L.cols.value_u16 || new Uint16Array(0);   // 'value' → the intensity channel
      }
      let got = 0;
      for await (const rc of streamChunks({ chunkPoints: 1 << 18 })) {
        if (epoch !== streamEpoch || disposed) return;
        b.push(rc);
        b.flush();                                         // progressive, chunk by chunk
        got += rc.count;
        invalidate();
      }
      const doc = b.flush();
      L.count = header.count || got;
      if (isBlocks && doc && Number.isFinite(doc.chanRange[0])) L.value_range = [doc.chanRange[0], doc.chanRange[1]];
      finishFileLayer(L, i, doc);
    } catch (e) {
      fileMsg = `${L.file.name}: ${e.message}`;
      schedule();
    }
  };

  // the ACTIVE value channel: a layer may ship several (value=["FE","SIO2"]);
  // the style's `value` names the live one, and switching re-aliases
  // L.cols.value / value_u16 / value_range so EVERY reader (the GPU build,
  // threshold, pick readout, legend) sees the chosen channel.
  const resolveChannel = (L, s) => {
    const names = L.value_channels || [];
    if (!names.length) return;
    if (!L._chans) {
      L._chans = names.map((nm, k) => ({
        name: nm,
        value: L.cols[k === 0 ? 'value' : 'value' + k],
        u16: L.cols[k === 0 ? 'value_u16' : 'value_u16_' + k],
        range: (L.value_ranges || [L.value_range])[k] || L.value_range,
      }));
    }
    let k = s && s.value ? L._chans.findIndex((c) => c.name === s.value) : 0;
    if (k < 0) k = 0;
    const c = L._chans[k];
    L.cols.value = c.value;
    if (c.u16) L.cols.value_u16 = c.u16;
    L.value_range = c.range;
    L._active = c.name;
  };

  // one layer → engine chunks. Shared by load() and rebuildLayer() (a channel
  // switch rebuilds just its own layer from the already-resident columns).
  // Returns the layer's local bbox (null while a streamed layer has no rows).
  const buildLayer = (L, i) => {
    if (L.file) {                                          // via='files': async browser-side read
      fileQueue = fileQueue.then(() => buildFileLayer(L, i));
      return null;
    }
    const frame = { origin: payload.frame, crs: null, units: 'm' };
    const cols = L.cols;
    resolveChannel(L, styleAt(i));
    let doc = null;
    if (L.kind === 'blocks') {
        const grid = makeBlockGrid(L.axes.map(([origin, pitch, count]) => ({ origin, pitch, count })), frame);
        const b = createBlockChunkBuilder({
          frame, grid, chunkSize: 1 << 18, seed: 1,
          dimPalette: L.dim_palette || null,               // sub-blocked: per-code half-dims
          onChunk: (c) => renderer.addChunk(c, 'base', i),
        });
        if (L.streamed) {
          // cd.open(): header-only in the payload — rows arrive as wire-v3
          // chunks over custom messages, pushed into this SAME builder with a
          // running recStart (progressive render for free). JS keeps only
          // ijk + value + cat (~11 B/block); positions reconstruct lazily.
          const n = L.count;
          const st = {
            b, got: 0, done: false, kind: 'blocks',
            i: new Uint16Array(n), j: new Uint16Array(n), k: new Uint16Array(n),
            dim: L.dim_palette ? new Uint8Array(n) : null,
            value: L.value_range ? new Float32Array(n) : null,
            cat: L.cat_n ? new Uint8Array(n) : null,
          };
          (streams = streams || {})[i] = st;
          if (st.value) L.cols.value = st.value;           // threshold/legend read these
          if (st.cat) L.cols.cat = st.cat;
          const [[x0, xp], [y0, yp], [z0, zp]] = L.axes;
          L._posAt = (r) => [x0 + st.i[r] * xp, y0 + st.j[r] * yp, z0 + st.k[r] * zp];
          L._ijk = { st, x0, xp, y0, yp, z0, zp };
          st.worker = spawnStreamWorker(L, i, st, {
            kind: 'blocks', frameOrigin: [...frame.origin], axes: L.axes, dimPalette: L.dim_palette || null,
          });
          if (L.cat_n) renderer.setCategories(L.cat_n);
          if (L.bbox) {                                    // header bbox (world) seeds the fit before rows land
            doc = { bboxLocal: Float64Array.from(L.bbox.map((v, a) => v - frame.origin[a % 3])) };
          }
        } else {
          let bx = cols.x, by = cols.y, bz = cols.z;
          if (L.pos === 'ijk') {
            // wire v3: u16 lattice indices → exact f64 coords (origin + index·pitch,
            // computed here in f64 — quantization without loss). Stashed as _pos so
            // the pick readout / measure / select-through read reconstructed coords.
            const [[x0, xp], [y0, yp], [z0, zp]] = L.axes;
            const n = L.count, I = cols.i, J = cols.j, K = cols.k;
            bx = new Float64Array(n); by = new Float64Array(n); bz = new Float64Array(n);
            for (let q = 0; q < n; q++) { bx[q] = x0 + I[q] * xp; by[q] = y0 + J[q] * yp; bz[q] = z0 + K[q] * zp; }
            L._pos = { x: bx, y: by, z: bz };
          }
          b.push({ count: L.count, x: bx, y: by, z: bz, chan: cols.value || null, cat: cols.cat || null, dim: cols.dim || null, recStart: 0 });
          doc = b.flush();
          if (L.cat_n) renderer.setCategories(L.cat_n);
        }
      } else if (L.kind === 'surface') {
        // a regular 2D grid → shaded relief (smooth normals, nodata holes),
        // colored by its own elevation or by the drape grid through the layer
        // ramp + clip. Rebuilt by rebuildLayer when ramp/clip/color change —
        // a DEM-sized mesh rebuilds in milliseconds.
        const grid = {
          nx: L.nx, ny: L.ny, data: cols.grid,
          x0: L.x0, y0: L.y0, dx: L.dx, dy: L.dy,
          nodata: L.nodata == null ? null : L.nodata,
        };
        const stride = L.stride || Math.max(1, Math.ceil(Math.sqrt((L.nx * L.ny * 2) / 2_000_000)));
        const m = buildHeightfieldMesh(grid, { stride, frame, flatZ: L.flat_z != null ? L.flat_z : null });
        if (m) {
          const s = styleAt(i);
          const hex = String(s.color || '').replace('#', '');
          if (hex.length !== 6) {                          // 'value': ramp the drape (or the elevation itself)
            let vals = m.values;
            if (L.drape && cols.drape) {
              // mirrors buildHeightfieldMesh's vertex walk (same stride, same
              // DEM-nodata skip) to sample the drape at each kept vertex
              const nd = grid.nodata;
              const bad = (v) => Number.isNaN(v) || (nd != null && (nd >= 1.7e38 ? v >= 1.7014e38 : v === nd));
              const cN = Math.floor((L.nx - 1) / stride) + 1, rN = Math.floor((L.ny - 1) / stride) + 1;
              const dv = [];
              for (let r = 0; r < rN; r++) {
                for (let c2 = 0; c2 < cN; c2++) {
                  const gr = Math.min(L.ny - 1, r * stride), gc = Math.min(L.nx - 1, c2 * stride);
                  if (bad(cols.grid[gr * L.nx + gc])) continue;
                  dv.push(cols.drape[gr * L.nx + gc]);
                }
              }
              vals = Float32Array.from(dv);
            }
            const range = (s.clip && s.clip.length === 2) ? s.clip : (L.value_range || [0, 1]);
            const px = rampPixels(256, RAMPS[s.ramp || 'viridis'] || undefined);
            const span = range[1] - range[0] || 1;
            const color = new Float32Array(vals.length * 3);
            for (let q = 0; q < vals.length; q++) {
              const t = Math.max(0, Math.min(255, Math.round(((vals[q] - range[0]) / span) * 255)));
              color[q * 3] = px[t * 4] / 255; color[q * 3 + 1] = px[t * 4 + 1] / 255; color[q * 3 + 2] = px[t * 4 + 2] / 255;
            }
            m.color = color;
          }
          L._surfKey = `${s.color}|${s.ramp}|${s.clip}`;   // rebuild trigger (see applyStyles)
          doc = m;
          renderer.addChunk(m, 'base', i);
        }
      } else if (L.kind === 'mesh') {
        // context tier: scenery, recordless, drawn whole. Vertices arrive f32
        // about the mesh's own center — add the f64 origin back, then
        // buildMeshChunk rebases to the SHARED frame (so meshes co-register
        // with the data layers and mine-grid coordinates stay exact).
        const [ox, oy, oz] = L.pos_origin || [0, 0, 0];
        const vertices = new Float64Array(cols.verts.length);
        for (let q = 0; q < cols.verts.length; q += 3) {
          vertices[q] = ox + cols.verts[q]; vertices[q + 1] = oy + cols.verts[q + 1]; vertices[q + 2] = oz + cols.verts[q + 2];
        }
        doc = buildMeshChunk({ vertices, triangles: cols.tris, frame });
        renderer.addChunk(doc, 'base', i);
      } else if (L.kind === 'drillholes') {
        if (!L._collars) {                                 // labels: BHID + world collar position
          const names = L.hole_names || [];
          L._collars = [];
          for (let q = 0; q < cols.c_bhid.length; q++) {
            const code = cols.c_bhid[q];
            L._collars.push({ name: names[code] != null ? names[code] : `#${code}`, x: cols.c_x[q], y: cols.c_y[q], z: cols.c_z[q] });
          }
        }
        // the desurvey is GEOMETRY — cache it; a value-channel switch only
        // needs the chan column re-read from the active channel by record
        let seg = L._seg;
        if (!seg) {
          seg = L._seg = drillholeSegments(L, cols);
        } else if (cols.value) {
          for (let q = 0; q < seg.count; q++) {
            const s2 = seg.recIdx[q];
            seg.chan[q] = Number.isFinite(cols.value[s2]) ? cols.value[s2] : 0;
          }
        }
        // the desurvey computes these, so stash the interval midpoints by ROW:
        // measure and the readout need a position for a drillhole pick too
        L._pos = { x: new Float64Array(L.count), y: new Float64Array(L.count), z: new Float64Array(L.count) };
        for (let q = 0; q < seg.count; q++) {
          const r = seg.recIdx[q];
          L._pos.x[r] = seg.x[q]; L._pos.y[r] = seg.y[q]; L._pos.z[r] = seg.z[q];
        }
        const b = createStickChunkBuilder({ frame, chunkSize: 1 << 16, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        b.push({ count: seg.count, ax: seg.ax, ay: seg.ay, az: seg.az, bx: seg.bx, by: seg.by, bz: seg.bz,
          x: seg.x, y: seg.y, z: seg.z, chan: seg.chan, cat: seg.cat, recIdx: seg.recIdx });
        doc = b.flush();
        if (L.cat_n) renderer.setCategories(L.cat_n);
      } else if (L.streamed) {
        // cd.open(kind='points'): f32 local positions stay RESIDENT (~17 B/pt —
        // a cloud has no lattice to reconstruct from), value/cat beside them;
        // the u16 intensity each chunk needs is quantized here from the
        // header's value_range.
        const b = createChunkBuilder({ frame, chunkSize: 1 << 19, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        const n = L.count;
        const st = {
          b, got: 0, done: false, kind: 'points',
          x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
          value: L.value_range ? new Float32Array(n) : null,
          cat: L.cat_n ? new Uint8Array(n) : null,
        };
        (streams = streams || {})[i] = st;
        if (st.value) L.cols.value = st.value;
        if (st.cat) L.cols.cat = st.cat;
        const [ox, oy, oz] = L.pos_origin || [0, 0, 0];
        L._posAt = (r) => [ox + st.x[r], oy + st.y[r], oz + st.z[r]];
        L._pstream = { st, ox, oy, oz };
        st.worker = spawnStreamWorker(L, i, st, { kind: 'points', frameOrigin: [...frame.origin] });
        if (L.cat_n) renderer.setLayerCats(i, L.cat_n);
        if (L.bbox) doc = { bboxLocal: Float64Array.from(L.bbox.map((v, a) => v - frame.origin[a % 3])) };
      } else {
        const b = createChunkBuilder({ frame, chunkSize: 1 << 19, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        let px = cols.x, py = cols.y, pz = cols.z;
        if (L.pos_origin) {
          // wire v3: f32 positions about the layer's bbox center — add the f64
          // origin back BEFORE the engine sees a coordinate (the float32 wall
          // never applies). Stashed as _pos for readout / measure / select-through.
          const [ox, oy, oz] = L.pos_origin;
          const n = L.count;
          px = new Float64Array(n); py = new Float64Array(n); pz = new Float64Array(n);
          for (let q = 0; q < n; q++) { px[q] = ox + cols.x[q]; py[q] = oy + cols.y[q]; pz[q] = oz + cols.z[q]; }
          L._pos = { x: px, y: py, z: pz };
        }
        b.push({
          count: L.count, x: px, y: py, z: pz,
          intensity: cols.value_u16 || new Uint16Array(L.count),
          classification: cols.cat || new Uint8Array(L.count),
          rgb: cols.rgb || null, recStart: 0,
        });
        doc = b.flush();
        if (L.cat_n) renderer.setLayerCats(i, L.cat_n);
      }
      return doc && doc.bboxLocal ? doc.bboxLocal : null;
  };

  // a value-channel switch rebuilds ONE layer's chunks from the resident
  // columns — no re-send from the kernel, the camera stays put
  const rebuildLayer = (i) => {
    const L = payload && payload.layers[i];
    if (!L || L.streamed || L.file) return;                // streamed/files layers carry one channel
    renderer.removeLayer(i);
    buildLayer(L, i);
    invalidate();
  };

  const quantIntensity = (vals, range, n) => {             // points color from u16 intensity
    const out = new Uint16Array(n);
    if (!vals || !range) return out;
    const [lo, hi] = range;
    const span = hi - lo || 1;
    for (let q = 0; q < n; q++) {
      const v = vals[q];
      out[q] = Number.isFinite(v) ? Math.max(0, Math.min(65535, Math.round(((v - lo) / span) * 65535))) : 0;
    }
    return out;
  };

  // ── the stream worker: chunk building off the main thread. The resident
  // columns are ALWAYS written first, so a worker failure at any point just
  // rebuilds inline from them — behavior-identical, only slower. ──
  const streamWorkerFail = (L, i, st, wk) => {
    try { wk.terminate(); } catch { /* gone */ }
    if (st.worker !== wk) return;
    st.worker = null;                                      // later chunks go inline
    renderer.removeLayer(i);
    const n = st.got;
    if (n) {
      if (st.kind === 'points') {
        const { ox, oy, oz } = L._pstream;
        const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
        for (let q = 0; q < n; q++) { x[q] = ox + st.x[q]; y[q] = oy + st.y[q]; z[q] = oz + st.z[q]; }
        st.b.push({ count: n, x, y, z, intensity: quantIntensity(st.value, L.value_range, n),
          classification: st.cat ? st.cat.subarray(0, n) : new Uint8Array(n), rgb: null, recStart: 0 });
      } else {
        const { x0, xp, y0, yp, z0, zp } = L._ijk;
        const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
        for (let q = 0; q < n; q++) { x[q] = x0 + st.i[q] * xp; y[q] = y0 + st.j[q] * yp; z[q] = z0 + st.k[q] * zp; }
        st.b.push({ count: n, x, y, z, chan: st.value ? st.value.subarray(0, n) : new Float32Array(n),
          cat: st.cat ? st.cat.subarray(0, n) : null, dim: st.dim ? st.dim.subarray(0, n) : null, recStart: 0 });
      }
      st.b.flush();
    }
    invalidate();
  };
  const spawnStreamWorker = (L, i, st, init) => {
    try {
      if (typeof Worker === 'undefined' || !import.meta.url) return null;
      const wk = new Worker(import.meta.url, { type: 'module' });
      wk.onmessage = (e) => {
        const m = e.data;
        if (disposed || !streams || streams[i] !== st) { try { wk.terminate(); } catch { /* gone */ } return; }
        if (m.chunk) {
          renderer.addChunk(m.chunk, 'base', i);
          invalidate();
        } else if (m.done) {
          if (m.done.bboxLocal && Number.isFinite(m.done.bboxLocal[0])) mergeBbox(Float64Array.from(m.done.bboxLocal));
          applyStyles();
          if (tb) syncChrome();
          invalidate();
          try { wk.terminate(); } catch { /* gone */ }
        } else if (m.err) {
          streamWorkerFail(L, i, st, wk);
        }
      };
      wk.onerror = () => streamWorkerFail(L, i, st, wk);
      wk.postMessage({ init });
      console.log('gcu.condenser: worker chunk builder engaged');
      return wk;
    } catch { return null; }                               // file://, odd CSP — inline is identical
  };

  // ── streamed chunks (cd.open): epoch-guarded wire-v3 batches into the open
  // builder — each push lands a chunk on the GPU, so the model renders as it
  // arrives, exactly like the engine streaming a file in micro. ──
  const asTyped = (b, T, n) => {
    if (!b) return null;
    const buf = ArrayBuffer.isView(b) ? b.buffer : b;
    const off = ArrayBuffer.isView(b) ? b.byteOffset : 0;
    if (off % T.BYTES_PER_ELEMENT === 0) return new T(buf, off, n);
    return new T(new Uint8Array(buf, off, n * T.BYTES_PER_ELEMENT).slice().buffer);
  };
  const onCustom = (content, buffers) => {
    if (disposed || !content || !streams || !payload) return;
    if (content.epoch !== streamEpoch) return;             // a stale stream another view requested
    const li = content.layer, st = streams[li];
    const L = payload.layers[li];
    if (!st || !L || st.done) return;
    if (content.type === 'chunk') {
      const names = content.cols || [];
      const cap = st.kind === 'points' ? st.x.length : st.i.length;
      const take = Math.min(content.rows >>> 0, cap - st.got);
      if (take <= 0) return;
      const TA = st.kind === 'points'
        ? { x: Float32Array, y: Float32Array, z: Float32Array, value: Float32Array, cat: Uint8Array }
        : { i: Uint16Array, j: Uint16Array, k: Uint16Array, dim: Uint8Array, value: Float32Array, cat: Uint8Array };
      const got = {};
      names.forEach((nm, bi) => { if (TA[nm]) got[nm] = asTyped(buffers[bi], TA[nm], take); });
      if (st.value && got.value) st.value.set(got.value.subarray(0, take), st.got);
      if (st.cat && got.cat) st.cat.set(got.cat.subarray(0, take), st.got);
      let raw;                                             // the builder push, worker or inline
      if (st.kind === 'points') {
        if (!got.x || !got.y || !got.z) return;
        st.x.set(got.x.subarray(0, take), st.got);
        st.y.set(got.y.subarray(0, take), st.got);
        st.z.set(got.z.subarray(0, take), st.got);
        const { ox, oy, oz } = L._pstream;
        const px2 = new Float64Array(take), py2 = new Float64Array(take), pz2 = new Float64Array(take);
        for (let q = 0; q < take; q++) { px2[q] = ox + got.x[q]; py2[q] = oy + got.y[q]; pz2[q] = oz + got.z[q]; }
        // the points pipeline colors from u16 intensity: quantize this batch
        // against the header's value range (fixed, so chunks agree)
        raw = { count: take, x: px2, y: py2, z: pz2,
          intensity: got.value ? quantIntensity(got.value, L.value_range, take) : new Uint16Array(take),
          classification: got.cat ? got.cat.slice(0, take) : new Uint8Array(take),
          rgb: null, recStart: st.got };
      } else {
        if (!got.i || !got.j || !got.k) return;
        st.i.set(got.i.subarray(0, take), st.got);
        st.j.set(got.j.subarray(0, take), st.got);
        st.k.set(got.k.subarray(0, take), st.got);
        if (st.dim && got.dim) st.dim.set(got.dim.subarray(0, take), st.got);
        const { x0, xp, y0, yp, z0, zp } = L._ijk;
        const bx = new Float64Array(take), by = new Float64Array(take), bz = new Float64Array(take);
        for (let q = 0; q < take; q++) {
          bx[q] = x0 + got.i[q] * xp; by[q] = y0 + got.j[q] * yp; bz[q] = z0 + got.k[q] * zp;
        }
        raw = { count: take, x: bx, y: by, z: bz,
          chan: got.value ? got.value.slice(0, take) : new Float32Array(take),   // the builder concats chan unconditionally
          cat: got.cat ? got.cat.slice(0, take) : null,
          dim: got.dim ? got.dim.slice(0, take) : null, recStart: st.got };
      }
      st.got += take;
      if (st.worker) {
        // Morton/quantize OFF the main thread; raw's arrays are fresh copies,
        // so they transfer — zero main-thread sort work per message
        const t2 = new Set();
        for (const k2 in raw) { const v = raw[k2]; if (v && ArrayBuffer.isView(v)) t2.add(v.buffer); }
        st.worker.postMessage({ push: raw }, [...t2]);
      } else {
        st.b.push(raw);
        st.b.flush();                                      // emit NOW — progressive at message granularity
        invalidate();                                      // new chunks restart the accumulation
      }
    } else if (content.type === 'eof') {
      st.done = true;
      if (st.worker) {
        st.worker.postMessage({ eof: true });              // its 'done' finishes bbox/styles/chrome
        return;
      }
      const doc = st.b.flush();
      if (doc && doc.bboxLocal && docBbox) {
        for (let a = 0; a < 3; a++) {
          if (doc.bboxLocal[a] < docBbox[a]) docBbox[a] = doc.bboxLocal[a];
          if (doc.bboxLocal[a + 3] > docBbox[a + 3]) docBbox[a + 3] = doc.bboxLocal[a + 3];
        }
        renderer.setDocBbox(docBbox);
      }
      applyStyles();                                       // threshold masks now see the full column
      if (tb) syncChrome();                                // legend over the final values
      invalidate();
    }
  };

  // ── styles: everything the engine keeps per LAYER ──
  const applyStyles = () => {
    if (!payload) return;
    styles().forEach((s, i) => {                           // chunk-rebuilding changes first
      const L = payload.layers[i];
      if (!L) return;
      if (L.kind === 'surface') {                          // surface color bakes into vertices
        if (L._surfKey != null && L._surfKey !== `${s.color}|${s.ramp}|${s.clip}`) rebuildLayer(i);
        return;
      }
      if (!L.value_channels || L.value_channels.length < 2) return;
      const want = s.value && L.value_channels.includes(s.value) ? s.value : L.value_channels[0];
      if (L._active && want !== L._active) rebuildLayer(i);   // value-channel switch
    });
    styles().forEach((s, i) => {
      const L = payload.layers[i];
      if (!L) return;
      renderer.setLayerVisible(i, s.visible !== false);
      renderer.setLayerOpacity(i, s.opacity == null ? 1 : s.opacity);
      renderer.setLayerSectioned(i, s.sectioned === undefined ? true : s.sectioned);
      const stops = RAMPS[s.ramp || 'viridis'];
      renderer.setLayerRamp(i, stops ? rampPixels(256, stops) : null);
      if (L.kind === 'blocks') renderer.setLayerEdges(i, !!s.block_edges);
      if (L.kind === 'drillholes') renderer.setLayerStickRadius(i, s.radius || 1.5);
      if (L.kind === 'mesh' || L.kind === 'surface') {
        const hx = String(s.color || '').replace('#', '');  // mesh/surface hex color is a TINT, not a mode
        if (hx.length === 6) {
          const v2 = parseInt(hx, 16);
          renderer.setLayerMeshStyle(i, { tint: [((v2 >> 16) & 255) / 255, ((v2 >> 8) & 255) / 255, (v2 & 255) / 255] });
        }
      }
      // per-class eyes: GPU-side cull by category code; composes with the
      // threshold mask, and hidden classes don't pick either
      const hid = s.categories_hidden;
      if (L.cat_labels && hid && hid.length) {
        const vis = new Uint8Array(256).fill(1);
        for (const lb of hid) { const k = L.cat_labels.indexOf(lb); if (k >= 0) vis[k] = 0; }
        renderer.setLayerCatVisibility(i, vis);
      } else {
        renderer.setLayerCatVisibility(i, null);
      }
      const v = L.cols.value, t = s.threshold;
      if (v && t && t.length === 2) {
        const mask = new Uint8Array(v.length);
        for (let q = 0; q < v.length; q++) mask[q] = (v[q] >= t[0] && v[q] <= t[1]) ? 1 : 0;
        renderer.setFilter(mask, { isolate: s.filter_mode !== 'dim' }, i);
      } else {
        renderer.setFilter(null, {}, i);
      }
    });
    schedule();
  };

  const applyBackground = () => {
    const hex = String(model.get('background') || '#121212').replace('#', '');
    if (hex.length !== 6) return;
    const v = parseInt(hex, 16);
    renderer.setBackground([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1]);
    schedule();
  };
  const applyHeight = () => { host.style.height = `${model.get('height') || 460}px`; invalidate(); };
  const applyZExag = () => {                               // display-only: queries stay in real coords
    cam.state.zExag = Math.max(0.1, +model.get('z_exaggeration') || 1);
    cam.update();
    invalidate();
  };

  // ── the camera as PYTHON STATE, in geologist terms. azimuth = bearing of the
  // VIEW direction (from north, clockwise); plunge positive downward; target in
  // WORLD coordinates. Orbit math: eye = target + r·[cosφcosθ, cosφsinθ, sinφ],
  // so the view's horizontal direction is (−cosθ, −sinθ) and plunge = φ. ──
  const camToDict = () => {
    const c = cam.state, o = (payload && payload.frame) || [0, 0, 0];
    const az = (Math.atan2(-Math.cos(c.theta), -Math.sin(c.theta)) * 180 / Math.PI + 360) % 360;
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      azimuth: r2(az), plunge: r2(c.phi * 180 / Math.PI), distance: r2(c.radius),
      target: [r2(c.target[0] + o[0]), r2(c.target[1] + o[1]), r2(c.target[2] + o[2])],
      ortho: !!c.ortho,
    };
  };
  let camLast = '';
  const pushCamera = () => {                               // called from draw(): debounce-by-value
    if (disposed) return;
    const j = JSON.stringify(camToDict());
    if (j === camLast) return;
    camLast = j;
    try { model.set('camera', JSON.parse(j)); model.save_changes(); } catch { /* detached */ }
  };
  const applyCamera = () => {
    const v = model.get('camera') || {};
    if (!Object.keys(v).length) return;
    const cur = camToDict();
    if (['azimuth', 'plunge', 'distance', 'ortho'].every((k) => v[k] == null || JSON.stringify(v[k]) === JSON.stringify(cur[k]))
      && (v.target == null || JSON.stringify(v.target) === JSON.stringify(cur.target))) return;   // our own echo
    const c = cam.state;
    if (v.azimuth != null) { const az = (+v.azimuth) * Math.PI / 180; c.theta = Math.atan2(-Math.cos(az), -Math.sin(az)); }
    if (v.plunge != null) c.phi = Math.max(-Math.PI / 2 + 0.011, Math.min(Math.PI / 2 - 0.011, (+v.plunge) * Math.PI / 180));
    if (v.distance != null) c.radius = Math.max(0.05, +v.distance);
    if (v.target) {
      const o = (payload && payload.frame) || [0, 0, 0];
      c.target = [v.target[0] - o[0], v.target[1] - o[1], v.target[2] - o[2]];
    }
    if (v.ortho != null) { cam.setOrtho(!!v.ortho); if (tb) tb.syncOrtho(!!v.ortho); }
    cam.update();
    userCam = true;                                        // a SET camera is sacred
    needFit = false;
    invalidate();
  };

  // ── the section's world extent along its normal, for the scrub slider ──
  const sectionExtent = (sec) => {
    if (!payload || !docBbox) return [0, 1];
    const n = normalOf(sec) || [0, 1, 0], o = payload.frame;
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < 8; c++) {
      const p = [docBbox[(c & 1) ? 3 : 0], docBbox[(c & 2) ? 4 : 1], docBbox[(c & 4) ? 5 : 2]];
      const d = (p[0] + o[0]) * n[0] + (p[1] + o[1]) * n[1] + (p[2] + o[2]) * n[2];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return [lo, hi];
  };

  // the legend follows the first VISIBLE layer colored by value (a ramp) or by
  // category (a swatch list whose rows toggle that class's visibility)
  const CAT_PX = categoryPalettePixels(256);               // the SAME palette the shaders sample
  const toggleCat = (li, label) => {
    const next = styles().map((s, k) => {
      if (k !== li) return s;
      const hid = new Set(s.categories_hidden || []);
      if (hid.has(label)) hid.delete(label); else hid.add(label);
      return { ...s, categories_hidden: [...hid] };
    });
    model.set('_styles', next);                            // round-trips to the Python Layer
    model.save_changes();
    applyStyles();
    syncChrome();
  };
  const legendInfo = () => {
    const st = styles();
    for (let i = 0; i < st.length; i++) {
      const s = st[i], L = payload && payload.layers[i];
      if (!L || s.visible === false) continue;
      if (s.color === 'value') {
        const range = (s.clip && s.clip.length === 2) ? s.clip : (L.value_range || null);
        if (!range) continue;
        const stops = RAMPS[s.ramp || 'viridis'];
        // the ramp needs a NAME — with channel switching, "0.2 — 34" alone is ambiguous
        const label = (L._active && L._active !== 'value') ? L._active : (s.name || null);
        return { range, pixels: rampPixels(256, stops || undefined), label };
      }
      if (s.color === 'category' && L.cat_labels && L.cat_labels.length) {
        const hid = new Set(s.categories_hidden || []);
        return {
          cats: L.cat_labels.map((lb, k) => ({
            label: lb, rgb: [CAT_PX[k * 4], CAT_PX[k * 4 + 1], CAT_PX[k * 4 + 2]], hidden: hid.has(lb),
          })),
          onToggle: (lb) => toggleCat(i, lb),
        };
      }
    }
    return null;
  };

  const syncChrome = () => {
    if (!tb) return;
    const sec = model.get('section');
    tb.syncSection(sec, sec ? sectionExtent(sec) : null);
    tb.syncLegend(legendInfo());
    tb.syncOrtho(cam.state.ortho);
  };

  // camera presets — ONE implementation, shared by the toolbar and w.look()
  const setView = (k) => {
    const c = cam.state;
    if (k === 'plan') { c.theta = -Math.PI / 2; c.phi = Math.PI / 2 - 0.001; }
    else if (k === 'north') { c.theta = -Math.PI / 2; c.phi = 0; }
    else if (k === 'south') { c.theta = Math.PI / 2; c.phi = 0; }
    else if (k === 'east') { c.theta = Math.PI; c.phi = 0; }
    else if (k === 'west') { c.theta = 0; c.phi = 0; }
    else { c.theta = Math.PI / 4; c.phi = Math.PI / 5; }
    cam.update();
    userCam = true;                                        // a chosen view is a framed shot
    needFit = true; invalidate();
  };

  // the stored camera state. Applied on CHANGE *and* at load: a widget
  // displayed a second time (any cell whose value is the Viewer) builds a fresh
  // view, and it must not come up pointing somewhere else than its sibling.
  const applyView = () => {
    const v = model.get('_view') || {};
    if (v.name) setView(v.name);
    if (v.ortho != null) { cam.setOrtho(!!v.ortho); if (tb) tb.syncOrtho(!!v.ortho); }
    invalidate();
  };

  // GL + the decorations overlay composited — labels/scale bar/north arrow
  // belong in the figure. Shared by the toolbar button and w.snapshot().
  const compositeBlob = () => new Promise((res, rej) => {
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
    const g2 = tmp.getContext('2d');
    g2.drawImage(canvas, 0, 0);                            // preserveDrawingBuffer keeps this valid
    if (deco.width) g2.drawImage(deco, 0, 0, tmp.width, tmp.height);
    tmp.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png');
  });

  // ── the toolbar ──
  const buildToolbar = () => {
    if (tb) { tb.destroy(); tb = null; }
    if (model.get('toolbar') === false) return;
    tb = createToolbar(host, {
      layers: () => (payload ? payload.layers.map((L, i) => ({ name: styleAt(i).name || L.kind, kind: L.kind, visible: styleAt(i).visible !== false })) : []),
      setStyle: (i, patch) => {
        const next = styles().map((s, k) => (k === i ? { ...s, ...patch } : s));
        model.set('_styles', next);                        // syncs back to the Python Layer
        model.save_changes();
        applyStyles();
        syncChrome();
      },
      fit: () => { needFit = true; invalidate(); },
      setView,
      toggleOrtho: () => { const on = !cam.state.ortho; cam.setOrtho(on); invalidate(); return on; },
      isOrtho: () => cam.state.ortho,
      getSection: () => model.get('section'),
      setSection: (s) => { model.set('section', s); model.save_changes(); syncChrome(); invalidate(); },
      snapshot: () => {
        schedule();
        requestAnimationFrame(async () => {
          try {
            const b = await compositeBlob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = 'condenser.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          } catch (e) { hud.textContent = `snapshot failed: ${e.message}`; }
        });
      },
      onToolChange: (t) => {
        tb.setBand(null);
        measA = null;
        canvas.style.cursor = (t === 'knife' || t === 'rect' || t === 'lasso' || t === 'measure') ? 'crosshair' : '';
      },
      clearSelection: () => { selected.clear(); pushSelection(); if (tb) tb.showPick(null); },
      toggleThrough: () => {
        const on = !model.get('select_through');
        model.set('select_through', on);
        model.save_changes();
        return on;
      },
    });
    syncChrome();
  };

  // ── pointer: pick / knife (the toolbar decides which) ──
  const relXY = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  // unproject a screen point onto the horizontal plane through the camera target
  const groundAt = (sx, sy) => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const inv = mat4Inverse(cam.state.viewProj);
    if (!inv) return null;
    const nx = (sx / w) * 2 - 1, ny = 1 - (sy / h) * 2;
    const un = (z) => {
      const x = inv[0] * nx + inv[4] * ny + inv[8] * z + inv[12];
      const y = inv[1] * nx + inv[5] * ny + inv[9] * z + inv[13];
      const zz = inv[2] * nx + inv[6] * ny + inv[10] * z + inv[14];
      const ww = inv[3] * nx + inv[7] * ny + inv[11] * z + inv[15];
      return [x / ww, y / ww, zz / ww];
    };
    const a = un(-1), b = un(1);
    const dz = b[2] - a[2];
    const tz = cam.state.target[2];
    if (Math.abs(dz) < 1e-9) return [a[0], a[1], tz];
    const t = (tz - a[2]) / dz;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, tz];
  };

  const doKnife = (a, b) => {
    const p1 = groundAt(a[0], a[1]), p2 = groundAt(b[0], b[1]);
    if (!p1 || !p2) return;
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const n = [-dy / len, dx / len, 0];                    // horizontal perpendicular to the drag
    const o = payload ? payload.frame : [0, 0, 0];
    const position = (p1[0] + o[0]) * n[0] + (p1[1] + o[1]) * n[1] + (p1[2] + o[2]) * n[2];
    const cur = model.get('section') || {};
    model.set('section', { normal: n, position, thickness: cur.thickness || 20 });
    model.save_changes();
    syncChrome();
    invalidate();
  };

  const pickInfo = (hit) => {
    if (!hit || !payload) return null;
    const L = payload.layers[hit.layer];
    if (!L) return null;
    const c = L.cols, r = hit.rec;
    const name = styleAt(hit.layer).name || L.kind;
    const rows = [];
    if (L.kind === 'drillholes') {
      const names = L.hole_names || [];
      const code = c.i_bhid ? c.i_bhid[r] : null;
      rows.push(['hole', code != null && names[code] != null ? names[code] : `#${code}`]);
      if (c.i_from) rows.push(['from–to', `${fmtN(c.i_from[r])} – ${fmtN(c.i_to[r])}`]);
    } else {
      const pc = L._pos || c;                              // wire v3 reconstructs into _pos
      const p3 = L._posAt ? L._posAt(r) : (pc.x ? [pc.x[r], pc.y[r], pc.z[r]] : null);
      if (p3) rows.push(['x y z', `${fmtN(p3[0])} ${fmtN(p3[1])} ${fmtN(p3[2])}`]);
    }
    if (c.value) rows.push([L._active && L._active !== 'value' ? L._active : 'value', fmtN(c.value[r])]);
    if (c.cat && L.cat_labels) rows.push(['category', L.cat_labels[c.cat[r]] ?? String(c.cat[r])]);
    rows.push(['row', String(r)]);
    return { title: name, rows };
  };

  // a record's WORLD position (blocks/points carry their columns; drillholes
  // get theirs from the desurvey stash above)
  const posOf = (li, rec) => {
    const L = payload && payload.layers[li];
    if (!L) return null;
    if (L._posAt) return L._posAt(rec);                    // streamed: lattice reconstruction
    const c = L._pos || L.cols;
    if (!c || !c.x) return null;
    return [c.x[rec], c.y[rec], c.z[rec]];
  };

  const pointInPoly = (x, y, poly) => {
    let inside = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const xa = poly[a][0], ya = poly[a][1], xb = poly[b][0], yb = poly[b][1];
      if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
    return inside;
  };

  // ── region selection. The ID buffer already answers "which record is at this
  // pixel" for the whole viewport, so a marquee is: render the region's ids,
  // keep the pixels inside the shape, and collect the records. Which means what
  // you select is exactly what you can SEE — occluded elements are not caught,
  // the same contract as a click. ──
  const selected = new Map();                              // layer → Set(row)
  const packSelection = () => {
    let n = 0, total = 0;
    for (const set of selected.values()) if (set.size) { n++; total += set.size; }
    const buf = new ArrayBuffer(4 + n * 8 + total * 4);
    const dv = new DataView(buf);
    dv.setUint32(0, n, true);
    let off = 4;
    for (const [li, set] of selected) {
      if (!set.size) continue;
      dv.setUint32(off, li, true); dv.setUint32(off + 4, set.size, true);
      off += 8;
      for (const r of set) { dv.setUint32(off, r, true); off += 4; }
    }
    return buf;
  };
  const pushSelection = () => {
    styles().forEach((_s, i) => {
      const L = payload && payload.layers[i];
      const set = selected.get(i);
      if (!L) return;
      if (!set || !set.size) { renderer.setLayerSelection(i, null); return; }
      const mask = new Uint8Array(L.count);
      for (const r of set) if (r < mask.length) mask[r] = 1;
      renderer.setLayerSelection(i, mask);
    });
    model.set('_sel_rows', new DataView(packSelection()));
    model.save_changes();
    schedule();
  };
  // ── SELECT THROUGH: the swept volume, not the visible surface.
  //
  // The ID buffer only ever names the FRONT-MOST element per pixel, so a
  // surface selection cannot reach what is behind. Through-mode projects every
  // record to the screen and tests the shape instead — the same construction
  // micro's selectVolume uses, minus the streaming, because the widget already
  // holds the columns.
  //
  // It defeats OCCLUSION, which is the point — but not display state: a hidden
  // layer, an isolate-filtered element or a block outside the section slab is
  // not merely hidden behind something, it is not being shown, so the tube does
  // not take it. (micro's version tests only layer visibility; this is the
  // stricter reading and the one that matches what you can see.)
  const selectThrough = (rectCss, polyCss, additive) => {
    const vp = cam.state.viewProj, o = payload.frame;
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
    const secAll = sectionOf(model.get('section'), o);
    if (!additive) selected.clear();
    styles().forEach((sty, li) => {
      const L = payload.layers[li];
      if (!L || sty.visible === false) return;
      const A = L._ijk || null;                            // streamed blocks: lattice accessor, only rows that arrived
      const P = L._pstream || null;                        // streamed points: resident local f32 + origin
      const c = L._pos || L.cols;
      if (!A && !P && (!c || !c.x)) return;
      const val = L.cols.value, th = sty.threshold;
      const iso = !!(val && th && th.length === 2 && sty.filter_mode !== 'dim');
      const sec = sty.sectioned === false ? null : secAll;
      let set = selected.get(li);
      if (!set) selected.set(li, set = new Set());
      const n = A ? A.st.got : P ? P.st.got : Math.min(L.count, c.x.length);
      for (let r = 0; r < n; r++) {
        if (iso && !(val[r] >= th[0] && val[r] <= th[1])) continue;
        let X, Y, Z;
        if (A) { X = A.x0 + A.st.i[r] * A.xp - o[0]; Y = A.y0 + A.st.j[r] * A.yp - o[1]; Z = A.z0 + A.st.k[r] * A.zp - o[2]; }
        else if (P) { X = P.ox + P.st.x[r] - o[0]; Y = P.oy + P.st.y[r] - o[1]; Z = P.oz + P.st.z[r] - o[2]; }
        else { X = c.x[r] - o[0]; Y = c.y[r] - o[1]; Z = c.z[r] - o[2]; }
        if (sec && Math.abs(X * sec.n[0] + Y * sec.n[1] + Z * sec.n[2] - sec.d) > sec.half) continue;
        const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
        if (cw <= 1e-9) continue;                          // behind the eye
        const px = ((vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12]) / cw * 0.5 + 0.5) * W;
        if (px < rectCss.x || px > rectCss.x + rectCss.w) continue;
        const py = (0.5 - (vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13]) / cw * 0.5) * H;
        if (py < rectCss.y || py > rectCss.y + rectCss.h) continue;
        if (polyCss && !pointInPoly(px, py, polyCss)) continue;
        set.add(r);
      }
    });
    pushSelection();
    reportSelection();
  };

  const reportSelection = () => {
    if (!tb) return;
    const counts = [...selected.entries()].filter(([, v]) => v.size)
      .map(([li, v]) => [styleAt(li).name || `layer ${li}`, v.size.toLocaleString()]);
    tb.showPick(counts.length ? { title: model.get('select_through') ? 'selected (through)' : 'selected', rows: counts } : null);
  };

  const selectRegion = (rectCss, polyCss, additive) => {
    if (!payload) return;
    if (model.get('select_through')) return selectThrough(rectCss, polyCss, additive);
    const vo = viewOpts();
    const reg = renderer.pickRegion(rectCss, cam, {
      pointPx: vo.pointPx, blocksAsPoints: vo.asPoints,
      section: sectionOf(model.get('section'), payload.frame),
    });
    if (!additive) selected.clear();
    if (reg && reg.data) {
      const { data, w: rw, h: rh, dpr } = reg;
      for (let row = 0; row < rh; row++) {
        for (let col = 0; col < rw; col++) {
          const i = (row * rw + col) * 4;
          const g = data[i + 1] >>> 0;
          if (g === 0xFFFFFFFF) continue;                  // nothing at this pixel
          if (polyCss) {                                   // lasso: rows are BOTTOM-UP
            const cx = rectCss.x + col / dpr;
            const cy = rectCss.y + (rh - 1 - row) / dpr;
            if (!pointInPoly(cx, cy, polyCss)) continue;
          }
          const li = g & 0xFFFF;
          let set = selected.get(li);
          if (!set) selected.set(li, set = new Set());
          set.add(data[i] >>> 0);
        }
      }
    }
    pushSelection();
    reportSelection();
  };

  // ── measure: two picks, then distance + bearing + plunge (the numbers a
  // geologist actually wants off two points) ──
  let measA = null;
  const doMeasure = (hit, xy) => {
    if (!hit) return;
    const p = posOf(hit.layer, hit.rec);
    if (!p) return;
    if (!measA) { measA = { p, xy }; if (tb) { tb.setBand('measure', xy, xy); tb.showPick({ title: 'measure', rows: [['from', `${fmtN(p[0])} ${fmtN(p[1])} ${fmtN(p[2])}`], ['', 'click a second element']] }); } return; }
    const a = measA.p, b = p;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const dist = Math.hypot(dx, dy, dz);
    const horiz = Math.hypot(dx, dy);
    const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;   // from north, clockwise
    const plunge = -Math.atan2(dz, horiz) * 180 / Math.PI;              // + is downward
    model.set('measurement', {
      from: [a[0], a[1], a[2]], to: [b[0], b[1], b[2]],
      distance: dist, dx, dy, dz, bearing, plunge,
    });
    model.save_changes();
    if (tb) {
      tb.setBand('measure', measA.xy, xy);
      tb.showPick({ title: 'measure', rows: [
        ['distance', fmtN(dist)], ['dx dy dz', `${fmtN(dx)} ${fmtN(dy)} ${fmtN(dz)}`],
        ['bearing', `${fmtN(bearing)}\u00b0`], ['plunge', `${fmtN(plunge)}\u00b0`],
      ] });
    }
    measA = null;
  };

  let down = null, dragging = false, lasso = null;
  const DRAG_TOOLS = { knife: 'line', rect: 'rect', lasso: 'poly' };
  const onDown = (e) => {
    const t = tb ? tb.tool : 'pick';
    down = { xy: relXY(e), t, shift: e.shiftKey };
    if (DRAG_TOOLS[t]) {
      dragging = true;
      lasso = t === 'lasso' ? [relXY(e)] : null;
      e.stopPropagation(); e.preventDefault();
    }
  };
  const onMove = (e) => {
    if (!dragging || !down) return;
    e.stopPropagation();
    const xy = relXY(e);
    const kind = DRAG_TOOLS[down.t];
    if (kind === 'poly') {
      const last = lasso[lasso.length - 1];
      if (Math.hypot(xy[0] - last[0], xy[1] - last[1]) > 3) lasso.push(xy);
      if (tb) tb.setBand('poly', lasso);
    } else if (tb) tb.setBand(kind, down.xy, xy);
  };
  const onUp = (e) => {
    if (!down) return;
    const xy = relXY(e);
    const moved = Math.hypot(xy[0] - down.xy[0], xy[1] - down.xy[1]);
    if (dragging) {
      e.stopPropagation();
      dragging = false;
      const t0 = down.t, add = down.shift, a = down.xy, path = lasso;
      lasso = null; down = null;
      if (tb) tb.setBand(null);
      if (t0 === 'lasso') {
        // a lasso ENDS WHERE IT STARTED, so start-to-end displacement is ~0 for
        // every real loop — the twitch test has to be the path's EXTENT.
        if (!path || path.length < 3) return;
        const xsL = path.map((q) => q[0]), ysL = path.map((q) => q[1]);
        const x0 = Math.min(...xsL), y0 = Math.min(...ysL);
        const bw = Math.max(...xsL) - x0, bh = Math.max(...ysL) - y0;
        if (Math.max(bw, bh) < 8) return;
        selectRegion({ x: x0, y: y0, w: bw, h: bh }, path, add);
        return;
      }
      if (moved <= 8) return;                              // a twitch is not a gesture
      if (t0 === 'knife') { doKnife(a, xy); if (tb) tb.clearTool(); return; }
      if (t0 === 'rect') {
        selectRegion({ x: Math.min(a[0], xy[0]), y: Math.min(a[1], xy[1]), w: Math.abs(xy[0] - a[0]), h: Math.abs(xy[1] - a[1]) }, null, add);
      }
      return;
    }
    const t = down.t;
    down = null;
    if ((t !== 'pick' && t !== 'measure') || moved > 4 || !payload) return;   // a drag is navigation
    const vo = viewOpts();
    const hit = renderer.pick(xy[0], xy[1], cam, {
      pointPx: vo.pointPx, blocksAsPoints: vo.asPoints,
      section: sectionOf(model.get('section'), payload.frame),
    });
    if (t === 'measure') { doMeasure(hit, xy); schedule(); return; }
    renderer.setPicked(hit || null);
    model.set('selection', hit ? { layer: hit.layer, name: styleAt(hit.layer).name || '', row: hit.rec } : {});
    model.save_changes();
    if (tb) tb.showPick(pickInfo(hit));
    schedule();
  };
  // hover readout (opt-in): the pick box follows the cursor — inspection
  // without clicking. Throttled; only under the plain pick tool.
  let hoverAt = 0;
  const onHover = (e) => {
    if (!model.get('hover') || !payload || !tb || dragging || down) return;
    if (tb.tool !== 'pick') return;
    const now = performance.now();
    if (now - hoverAt < 90) return;
    hoverAt = now;
    const [hx, hy] = relXY(e);
    const vo = viewOpts();
    const hit = renderer.pick(hx, hy, cam, {
      pointPx: vo.pointPx, blocksAsPoints: vo.asPoints,
      section: sectionOf(model.get('section'), payload.frame),
    });
    tb.showPick(hit ? pickInfo(hit) : null);
  };
  const onHoverLeave = () => { if (model.get('hover') && tb) tb.showPick(null); };
  canvas.addEventListener('pointermove', onHover);
  canvas.addEventListener('pointerleave', onHoverLeave);

  // capture on the HOST so the knife can pre-empt the orbit handlers bound to
  // the canvas (capture runs parent → target)
  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('pointermove', onMove, true);
  host.addEventListener('pointerup', onUp, true);

  detach = attachOrbitInput(canvas, cam, { onChange: () => { userCam = true; schedule(); if (tb) tb.syncOrtho(cam.state.ortho); } });

  const subs = [
    ['change:_payload', load],
    ['change:_styles', () => { applyStyles(); syncChrome(); invalidate(); }],
    ['change:section', () => { syncChrome(); invalidate(); }],
    ['change:background', applyBackground],
    ['change:height', applyHeight],
    ['change:z_exaggeration', applyZExag],
    ['change:decorations', invalidate],
    ['change:toolbar', buildToolbar],
    ['change:edl', invalidate], ['change:edl_strength', invalidate], ['change:budget', invalidate],
    ['change:_fit', () => { needFit = true; invalidate(); }],
    ['change:_clear_sel', () => { selected.clear(); pushSelection(); if (tb) tb.showPick(null); }],
    ['change:select_through', () => { if (tb) tb.syncThrough(model.get('select_through')); }],
    ['change:_view', applyView],
    ['change:camera', applyCamera],
    ['change:hover', () => { if (!model.get('hover') && tb) tb.showPick(null); }],
    ['change:_snapshot_req', () => {                       // w.snapshot(): PNG bytes back to the kernel
      schedule();
      requestAnimationFrame(async () => {
        try {
          const b = await compositeBlob();
          model.set('snapshot_png', new DataView(await b.arrayBuffer()));
          model.save_changes();
        } catch { /* headless contexts without toBlob */ }
      });
    }],
    ['msg:custom', onCustom],
  ];
  for (const [ev, fn] of subs) model.on(ev, fn);

  ro = new ResizeObserver(() => invalidate());
  ro.observe(host);
  applyHeight();
  applyBackground();
  applyZExag();                                            // a re-displayed widget must match its stored state
  buildToolbar();
  if (tb) tb.syncThrough(model.get('select_through'));
  load();
  applyView();                                             // match any camera state already on the widget
  applyCamera();                                           // a stored numeric camera wins over the preset

  return () => {
    disposed = true;
    if (streams) for (const k in streams) { const stw = streams[k] && streams[k].worker; if (stw) try { stw.terminate(); } catch { /* gone */ } }
    if (raf) cancelAnimationFrame(raf);
    if (ro) ro.disconnect();
    if (detach) detach();
    if (tb) tb.destroy();
    host.removeEventListener('pointerdown', onDown, true);
    host.removeEventListener('pointermove', onMove, true);
    host.removeEventListener('pointerup', onUp, true);
    canvas.removeEventListener('pointermove', onHover);
    canvas.removeEventListener('pointerleave', onHoverLeave);
    for (const [ev, fn] of subs) model.off(ev, fn);
    try { renderer.clearChunks(); } catch { /* context already gone */ }
    const lose = renderer.gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    el.innerHTML = '';
  };
}
