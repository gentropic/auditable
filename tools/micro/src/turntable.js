// micro — a TURNTABLE video: the camera orbits the scene once (or part way) and
// every frame is the figure renderer's picture — rendered to convergence, with the
// decorations on it — so a two-million-block model records as smoothly as a small
// one, only slower. The browser's own MediaRecorder writes the file (WebM, or MP4
// where WebM can't be made); nothing leaves the machine. Pacing: the recorder is
// PAUSED while a frame renders and resumed for exactly one frame's time, so the
// video plays at an even speed however long each frame took.
import { S, requestRender } from './state.js';
import { applyCamera, captureCamera } from './camera.js';
import { floatWin, raiseWindow } from './windows.js';
import { deliverBlob } from './hostio.js';
import { _deco } from './deco.js';
const $ = (s) => document.querySelector(s);

// the app's side, passed in once (setTurntableHooks): renderFigureCanvas
let HK = {};
export function setTurntableHooks(h) { HK = h; }

export function turntableMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) if (MediaRecorder.isTypeSupported(t)) return t;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Record an orbit. Resolves to { blob, frames, mime } (or null when cancelled).
 * seconds · fps · degrees (360 = one full turn; negative turns the other way) ·
 * decorations · scale (1–2) · onProgress(i, n) · signal (AbortSignal).
 */
export async function recordTurntable({ seconds = 8, fps = 30, degrees = 360, decorations = true, scale = 1, onProgress = null, signal = null } = {}) {
  const mime = turntableMime();
  if (!mime) throw new Error('this browser cannot record video');
  if (!S.cam || !HK.renderFigureCanvas) throw new Error('nothing to record');
  seconds = Math.max(1, Math.min(120, +seconds || 8));
  fps = Math.max(5, Math.min(60, Math.round(+fps || 30)));
  const n = Math.max(2, Math.round(seconds * fps));
  const step = (((+degrees || 360) * Math.PI) / 180) / n;
  const cam0 = captureCamera();
  const first = HK.renderFigureCanvas(scale, { decorations });
  const out = document.createElement('canvas');
  out.width = first.width & ~1; out.height = first.height & ~1;     // even sizes: video encoders want them
  const g = out.getContext('2d');
  g.drawImage(first, 0, 0);
  const stream = out.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const chunks = [];
  const bps = Math.round(Math.min(16e6, Math.max(2e6, out.width * out.height * fps * 0.12)));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  rec.start();
  rec.pause();
  let cancelled = false;
  try {
    for (let i = 0; i < n; i++) {
      if (signal && signal.aborted) { cancelled = true; break; }
      if (i > 0) {
        S.cam.state.theta = cam0.theta + step * i;
        S.cam.update();
        const c = HK.renderFigureCanvas(scale, { decorations });
        g.drawImage(c, 0, 0);
      }
      rec.resume();
      if (track.requestFrame) track.requestFrame();
      await sleep(1000 / fps);
      rec.pause();
      if (onProgress) onProgress(i + 1, n);
      await sleep(0);                                       // let the window repaint its progress
    }
  } finally {
    rec.stop();
    await stopped;
    track.stop();
    applyCamera(cam0);
    requestRender();
  }
  if (cancelled) return null;
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), frames: n, mime };
}

// ── the window: length, turn, frame rate, decorations → Record ───────────────
let _win = null;
export function openTurntable() {
  if (_win) { raiseWindow(_win.el); return _win; }
  const win = floatWin({ title: 'turntable', sub: 'video', x: Math.max(12, innerWidth - 360), y: 96, w: 320, h: 300, onClose: () => { if (ctl) ctl.abort(); _win = null; } });
  _win = win;
  let ctl = null;
  win.body.style.cssText += 'display:flex;flex-direction:column;font-family:var(--mono);font-size:12px;padding:10px 12px;gap:8px';
  const mime = turntableMime();
  const field = (label, el) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; const s = document.createElement('span'); s.style.cssText = 'flex:1;color:var(--text)'; s.textContent = label; r.append(s, el); win.body.appendChild(r); return el; };
  const sel = (opts, v) => { const s = document.createElement('select'); s.className = 'sw-sel'; for (const [k, t] of opts) s.append(new Option(t, k)); s.value = String(v); return s; };
  const secs = field('length', sel([['4', '4 s'], ['8', '8 s'], ['12', '12 s'], ['20', '20 s']], 8));
  const turn = field('turn', sel([['360', 'a full turn'], ['-360', 'a full turn, the other way'], ['180', 'half a turn'], ['90', 'a quarter turn']], 360));
  const fps = field('frame rate', sel([['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps']], 30));
  const res = field('resolution', sel([['1', '1× (screen)'], ['2', '2×']], 1));
  const deco = document.createElement('input'); deco.type = 'checkbox'; deco.checked = !!(_deco.scale || _deco.north || _deco.legend || _deco.title);
  field('decorations (scale bar, north, legend, title)', deco);
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  note.textContent = mime ? `every frame is rendered to convergence, so a big model takes a while — the video still plays smoothly · ${mime.split(';')[0].replace('video/', '')}` : 'this browser cannot record video';
  win.body.appendChild(note);
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Record'; go.disabled = !mime;
  const prog = document.createElement('span'); prog.style.cssText = 'flex:1;color:var(--muted)';
  row.append(go, prog); win.body.appendChild(row);
  go.onclick = async () => {
    if (ctl) { ctl.abort(); return; }
    ctl = new AbortController();
    go.textContent = 'Cancel';
    try {
      const r = await recordTurntable({ seconds: +secs.value, degrees: +turn.value, fps: +fps.value, scale: +res.value, decorations: deco.checked, signal: ctl.signal, onProgress: (i, n) => { prog.textContent = `frame ${i} of ${n}`; } });
      if (!r) { prog.textContent = 'cancelled'; return; }
      const ext = r.mime.includes('mp4') ? 'mp4' : 'webm';
      const base = (_deco.titleText || 'micro').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'micro';
      const name = `${base}-turntable.${ext}`;
      prog.textContent = `${r.frames} frames → ${name}`;
      $('#meta').textContent = `turntable saved as ${name}`;
      deliverBlob(r.blob, name);
    } catch (e) { prog.textContent = e.message; }
    finally { ctl = null; go.textContent = 'Record'; }
  };
  return win;
}
