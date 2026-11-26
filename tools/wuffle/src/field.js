// wuffle FIELD — the geological compass (phone / lead-acid shell): device orientation →
// @gcu/bearing → a live Schmidt net + a measurement log. Moved verbatim out of index.html's
// inline script (2026-11-26) so the desk workbench can grow beside it; it still runs at import,
// against index.html's static DOM.
import { compass, Stereonet, conversions, curves } from '@gcu/bearing';
import { shell } from '@gcu/leadacid';
import { declination as wmmDeclination } from '@gcu/wmm';

const $ = id => document.getElementById(id);
let mode = 'plane';          // 'plane' | 'line'
let cur = null;              // last computed reading
let haveOrientation = false;
const log = [];

// keep the screen lit in the field (dogfoods shell.keepAwake)
if (shell.present) shell.keepAwake(true);

// the Schmidt net (equal-area is the structural-geology convention; the name
// puns on Wulff but orientation data belongs on an equal-area net)
const sn = new Stereonet({ projection: 'equal-area', size: 340, classPrefix: 'sn' });
const svg = sn.element();
$('netHost').appendChild(svg);
sn.render();

// data colours from the token layer (SVG presentation attributes can't resolve var())
const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const OR = { stroke: tok('--au-action'), fill: tok('--au-action') };   // measured plane — the thing you did
const BL = { stroke: tok('--au-info'), fill: tok('--au-info') };       // measured line

// SMOOTHNESS: sn.render() re-projects the whole graticule + every measured item
// each call — fine when data changes (measure/clear), far too heavy at 60 Hz.
// The moving live-preview rides a SEPARATE overlay (one <path> + one dot) that
// we update per frame WITHOUT any sn.render(). The overlay survives render()
// (bearing updates specific elements, never wipes the SVG).
const NS = 'http://www.w3.org/2000/svg';
const livePath = document.createElementNS(NS, 'path');
livePath.setAttribute('fill', 'none'); livePath.setAttribute('stroke', tok('--au-text-soft'));
livePath.setAttribute('stroke-width', '2'); livePath.setAttribute('stroke-dasharray', '5 4');
const liveDot = document.createElementNS(NS, 'circle');
liveDot.setAttribute('fill', tok('--au-text-soft')); liveDot.setAttribute('r', '0');
svg.appendChild(livePath); svg.appendChild(liveDot);

// static layer: only redrawn when the measurement set changes
function drawStatic() {
  sn.clear();
  for (const m of log) {
    if (m.mode === 'plane') sn.plane(m.d1, m.d2, OR);
    else sn.line(m.d1, m.d2, BL);
  }
  sn.render();
  svg.appendChild(livePath); svg.appendChild(liveDot);   // keep overlay on top
}

// live preview: reuse bearing's exact projection so the ghost matches how a
// measured plane will land.
function liveTrace() {
  if (!cur) { livePath.setAttribute('d', ''); liveDot.setAttribute('r', '0'); return; }
  if (mode === 'plane') {
    const pole = conversions.planeToDcos(fmt(cur.d1), cur.d2);
    let d = '';
    for (const seg of sn._projectCurve(curves.greatCircle(pole, 180))) {
      if (seg.length > 1) d += 'M' + seg.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
    }
    livePath.setAttribute('d', d); liveDot.setAttribute('r', '0');
  } else {
    const p = sn.projectLine(fmt(cur.d1), cur.d2);
    liveDot.setAttribute('cx', p.x); liveDot.setAttribute('cy', p.y); liveDot.setAttribute('r', '5');
    livePath.setAttribute('d', '');
  }
}
let raf = 0;
function requestLive() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; liveTrace(); }); }

function fmt(n) { return (Math.round(n) % 360 + 360) % 360; }
function setMode(m) {
  mode = m;
  $('mPlane').classList.toggle('on', m === 'plane');
  $('mLine').classList.toggle('on', m === 'line');
  $('l1').textContent = m === 'plane' ? 'dip dir' : 'trend';
  $('l2').textContent = m === 'plane' ? 'dip' : 'plunge';
  requestLive();
}
$('mPlane').onclick = () => setMode('plane');
$('mLine').onclick = () => setMode('line');

// one reading → the live dial. Fed by the fused stream inside the shell, by the
// deviceorientation events otherwise (or if the stream can't open).
let source = 'event';           // 'fused' once shell.orientation delivers
let lastPublish = null;         // { name, bytes, signed } — the smoke verifies the .sig against bytes
let accuracy = null;            // Android compass accuracy: 3 high · 2 med · 1 low · 0 unreliable
function onOrient(e) {
  if (e.alpha == null) return;
  haveOrientation = true;
  const opt = { declination: decl == null ? 0 : decl };
  const [d1, d2] = mode === 'plane'
    ? compass.planeFromDeviceOrientation(e.alpha, e.beta, e.gamma, opt)
    : compass.lineFromDeviceOrientation(e.alpha, e.beta, e.gamma, opt);
  cur = { d1, d2 };
  $('v1').innerHTML = fmt(d1) + '<small>°</small>';
  $('v2').innerHTML = Math.round(d2) + '<small>°</small>';
  $('lvl').style.width = Math.min(100, (d2 / 90) * 100) + '%';
  requestLive();
}
// absolute frame carries a compass-referenced alpha (Android); fall back.
window.addEventListener('deviceorientationabsolute', (e) => { if (source !== 'fused') onOrient(e); });
window.addEventListener('deviceorientation', (e) => { if (source !== 'fused' && !haveOrientation) onOrient(e); });

// v2: inside the shell, read the FUSED rotation vector through the sensor
// plugin instead of the event — same math downstream, but we get the compass
// accuracy the event hides, so the field geologist knows when to figure-8.
const ACC_LABEL = ['unreliable', 'low', 'medium', 'high'];
function setAccuracy(acc) {
  accuracy = acc;
  const label = ACC_LABEL[acc] || 'no contact';
  $('brandsub').textContent = 'compass · fused · ' + label;
  if (acc <= 1) msg('compass ' + label + ' — wave the phone in a figure-8 to calibrate', true);
  else if (acc === 2) msg('compass medium — a figure-8 would sharpen it');
  else msg('compass calibrated · lay the phone on a surface to measure');
}
async function startFused() {
  if (!shell.present) return;
  try {
    const o = await shell.orientation({ rateHz: 30 });
    o.on((r) => { source = 'fused'; onOrient(r); });
    o.onAccuracy(setAccuracy);
    o.onClose(() => { source = 'event'; resumeNeeded.fused = true; if (!document.hidden) startFused(); });   // shell closed it (pause) → reopen now if visible, else on resume
  } catch (e) {
    source = 'event';
    msg('fused compass unavailable (' + (e.message || e) + ') — using device orientation events');
  }
}
startFused();
// v3: position. Inside the shell, a gnss fix stream stamps every measurement
// with lat/lon (+ accuracy) — the first open asks for the location permission.
let lastFix = null;
// true north: the WMM declination at the fix (east positive; true = magnetic + decl).
// null until a fix arrives → readings stay magnetic and the label says so.
let decl = null;
function updateDeclination(f) {
  decl = wmmDeclination(f.lat, f.lon, new Date(), (f.alt || 0) / 1000);
  $('north').textContent = 'true N · decl ' + (decl >= 0 ? '+' : '') + decl.toFixed(1) + '°';
}
async function startGnss() {
  if (!shell.present) return;
  try {
    const g = await shell.gnss.location({ minMs: 2000 });
    g.on('fix', (f) => {
      const first = !lastFix;
      lastFix = f;
      if (first || Math.abs(f.lat - (decl == null ? 999 : lastFix.lat)) > 0.1) updateDeclination(f);
      $('pos').textContent = '±' + (f.acc == null ? '?' : Math.round(f.acc)) + ' m';
      if (first) msg('position ' + f.lat.toFixed(5) + ', ' + f.lon.toFixed(5) + ' (±' + (f.acc == null ? '?' : Math.round(f.acc)) + ' m)');
    });
    g.onClose(() => { resumeNeeded.gnss = true; if (!document.hidden) startGnss(); });
  } catch (e) {
    lastFix = null;
    $('pos').textContent = e.permission && e.permission.canRequest === false ? '' : 'no position';
    if (e.permission) msg('location ' + (e.permission.canRequest ? 'denied — measurements will not carry a position' : 'not available in this build'));
  }
}
startGnss();

// an outcrop photo per station: the viewfinder is plain getUserMedia (works on
// the desktop with a webcam too); the JPEG attaches to the LAST measurement and
// publishes beside the csv. In the shell, the camera plugin's permission is
// asked for first so the system dialog isn't nested inside the viewfinder.
const photos = new Map();           // entry.i → Blob (jpeg)
let camStream = null;
async function openCamera() {
  if (!log.length) { msg('measure first — the photo attaches to the last measurement', true); return false; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg('no camera API here', true); return false; }
  if (shell.present) {
    const p = await shell.camera.permission({ request: true });
    if (!p.granted) { msg(p.canRequest ? 'camera denied' : 'no camera in this build', true); return false; }
  }
  try {
    // a field photo wants pixels: ask for a large frame (ideal, not exact — the
    // camera gives what it has; the desktop webcam gives 640×480 and that's fine)
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
  } catch (e) { msg('camera: ' + (e.message || e), true); return false; }
  $('camv').srcObject = camStream;
  $('cam').hidden = false;
  return true;
}
function closeCamera() {
  if (camStream) { for (const t of camStream.getTracks()) t.stop(); camStream = null; }
  $('camv').srcObject = null;
  $('cam').hidden = true;
}
let lastShot = null;                // { width, height, size } of the last capture (for the smokes)
// a frame that has actually been painted: the first frames after the track
// starts are black on real sensors — wait for a few presented frames
function videoFrames(v, n = 3) {
  return new Promise((resolve) => {
    if (!('requestVideoFrameCallback' in v)) { setTimeout(resolve, 400); return; }
    let k = 0;
    const tick = () => { if (++k >= n) resolve(); else v.requestVideoFrameCallback(tick); };
    v.requestVideoFrameCallback(tick);
  });
}
async function snapPhoto() {
  const v = $('camv');
  for (let i = 0; i < 50 && !v.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
  if (!v.videoWidth) return null;
  await videoFrames(v);
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (!blob) { resolve(null); return; }
      const m = log[log.length - 1];
      m.photo = 'wuffle-' + String(m.i).padStart(3, '0') + '-' + m.ts.replace(/[:.]/g, '').slice(0, 15) + '.jpg';
      photos.set(m.i, blob);
      lastShot = { width: c.width, height: c.height, size: blob.size };
      renderLog();
      msg('photo attached to #' + m.i + ' (' + Math.round(blob.size / 1024) + ' KB)');
      resolve(blob);
    }, 'image/jpeg', 0.9);
  });
}
$('photo').onclick = () => openCamera();
$('camx').onclick = () => closeCamera();
$('snap').onclick = async () => { await snapPhoto(); closeCamera(); };

// the shell closes push streams on pause (and says so); reopen on resume
const resumeNeeded = { fused: false, gnss: false };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (resumeNeeded.fused || source !== 'fused') { resumeNeeded.fused = false; startFused(); }
  if (resumeNeeded.gnss) { resumeNeeded.gnss = false; startGnss(); }
});

// intake (share's inbound twin): a CSV shared or opened into wuffle — a
// published log, or anything with the same columns — reloads into the log.
function loadCsv(text, name) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('empty');
  const head = lines[0].toLowerCase().split(',');
  const col = (k) => head.findIndex((h) => h.trim() === k);
  const iType = col('type'), iD1 = col('dip_dir_or_trend'), iD2 = col('dip_or_plunge'), iS = col('strike'), iTs = col('timestamp');
  const iLat = col('lat'), iLon = col('lon'), iAcc = col('acc_m');
  if (iType < 0 || iD1 < 0 || iD2 < 0) throw new Error('not a wuffle log (needs type, dip_dir_or_trend, dip_or_plunge)');
  let n = 0;
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const m = f[iType].trim() === 'line' ? 'line' : 'plane';
    const d1 = +f[iD1], d2 = +f[iD2];
    if (!Number.isFinite(d1) || !Number.isFinite(d2)) continue;
    const s = iS >= 0 && f[iS] !== undefined && f[iS].trim() !== '' ? +f[iS] : (m === 'plane' ? (fmt(d1) + 270) % 360 : null);
    const e = { i: log.length + 1, mode: m, d1: fmt(d1), d2: Math.round(d2), strike: s, ts: (iTs >= 0 && f[iTs]) || new Date().toISOString() };
    if (iLat >= 0 && iLon >= 0 && f[iLat] !== '' && Number.isFinite(+f[iLat])) { e.lat = +f[iLat]; e.lon = +f[iLon]; e.acc = iAcc >= 0 && f[iAcc] !== '' ? +f[iAcc] : null; }
    log.push(e);
    n++;
  }
  renderLog(); updateCount(); drawStatic();
  msg('loaded ' + n + ' measurement' + (n === 1 ? '' : 's') + ' from ' + name);
}
async function startIntake() {
  if (!shell.present) return;
  try {
    // the shim reopens this stream itself when the shell pauses (SPEC §4.5) —
    // a shared file is never lost to the pause that delivers it
    await shell.intake(async (item) => {
      try {
        if (item.kind === 'file') loadCsv(new TextDecoder().decode(await item.source.arrayBuffer()), item.name);
        else if (item.kind === 'text') loadCsv(item.text, 'shared text');
        else if (item.kind === 'error') msg(item.error + ' (' + item.name + ')', true);
      } catch (e) { msg('could not load ' + (item.name || 'the shared item') + ': ' + (e.message || e), true); }
    });
  } catch { /* no intake plugin in this build */ }
}
startIntake();

function updateCount() {
  $('count').textContent = log.length + ' measurement' + (log.length === 1 ? '' : 's');
}
// rebuild the log list from the array (newest first); each row deletes on tap-×
function renderLog() {
  const list = $('list'); list.innerHTML = '';
  for (let k = log.length - 1; k >= 0; k--) {
    const m = log[k];
    const li = document.createElement('li');
    const label = m.mode === 'plane'
      ? `<b>${String(m.d1).padStart(3, '0')}/${String(m.d2).padStart(2, '0')}</b><span>plane · strike ${String(m.strike).padStart(3, '0')}</span>`
      : `<b>${String(m.d1).padStart(3, '0')}→${String(m.d2).padStart(2, '0')}</b><span>line</span>`;
    li.innerHTML = label + (m.photo ? '<span class="pic" title="' + m.photo + '">📷</span>' : '') + '<button class="del" aria-label="delete measurement">×</button>';
    li.querySelector('.del').onclick = () => {
      log.splice(k, 1); renderLog(); updateCount(); drawStatic();
      if (navigator.vibrate) navigator.vibrate(10);
    };
    list.appendChild(li);
  }
}

function record(d1, d2, m, src = 'live') {
  const e = { i: log.length + 1, mode: m, d1: fmt(d1), d2: Math.round(d2),
    strike: m === 'plane' ? (fmt(d1) + 270) % 360 : null, ts: new Date().toISOString() };
  if (lastFix) { e.lat = +lastFix.lat.toFixed(6); e.lon = +lastFix.lon.toFixed(6); e.acc = lastFix.acc == null ? null : Math.round(lastFix.acc); }
  // what north this reading is referred to — a manual entry is whatever the user typed
  e.north = src === 'manual' ? 'as-typed' : (decl == null ? 'magnetic' : 'true');
  if (decl != null && src !== 'manual') e.decl = +decl.toFixed(2);
  log.push(e);
  renderLog(); updateCount(); drawStatic();
}

$('measure').onclick = () => {
  if (!cur) { msg('no orientation yet — tilt the phone (or type a measurement)', true); return; }
  record(cur.d1, cur.d2, mode);
  if (navigator.vibrate) navigator.vibrate(15);
  msg('measured ' + (mode === 'plane' ? fmt(cur.d1) + '/' + Math.round(cur.d2) : fmt(cur.d1) + '→' + Math.round(cur.d2)));
};

// manual entry (desktop analysis, or correcting a reading): "045/30" → plane,
// "310→70" or "310-70 line" → line. The tool is useful without a phone tilt.
function addManual(text) {
  const t = (text || '').trim();
  const mm = t.match(/^(\d{1,3})\s*[/→>-]\s*(\d{1,3})\s*(line|l)?$/i);
  if (!mm) { msg('type e.g. 045/30 (plane) or 310→70 line', true); return false; }
  const d1 = +mm[1], d2 = +mm[2];
  if (d2 > 90) { msg('dip/plunge must be 0–90', true); return false; }
  const kind = (mm[3] || (t.includes('→') ? 'line' : mode === 'line' ? 'line' : 'plane')).toLowerCase().startsWith('l') ? 'line' : 'plane';
  record(d1, d2, kind, 'manual');   // typed by the user — referred to whatever north they used
  msg('added ' + String(fmt(d1)).padStart(3, '0') + (kind === 'plane' ? '/' : '→') + d2);
  return true;
}
$('add').onclick = () => { if (addManual($('manual').value)) $('manual').value = ''; };
$('manual').addEventListener('keydown', (e) => { if (e.key === 'Enter' && addManual($('manual').value)) $('manual').value = ''; });

$('clear').onclick = () => { log.length = 0; renderLog(); updateCount(); msg(''); drawStatic(); };

$('publish').onclick = async () => {
  if (!log.length) { msg('nothing to publish', true); return; }
  const rows = ['type,dip_dir_or_trend,dip_or_plunge,strike,timestamp,lat,lon,acc_m,north,declination_deg,photo'];
  for (const m of log) rows.push(`${m.mode},${m.d1},${m.d2},${m.strike ?? ''},${m.ts},${m.lat ?? ''},${m.lon ?? ''},${m.acc ?? ''},${m.north || 'magnetic'},${m.decl ?? ''},${m.photo || ''}`);
  const csv = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n') + '\n');
  const bytes = new TextEncoder().encode(rows.join('\n') + '\n');
  if (shell.present) {
    try {
      await shell.publish('wuffle-log.csv', bytes, { collection: 'Downloads', mime: 'text/csv' });
      // provenance by construction: sign the published bytes with the phone's
      // hardware key (attest plugin) and publish the signature beside the log.
      // An instrument built without the attest plugin simply publishes unsigned.
      let signed = null;
      try {
        const a = await shell.attest.sign(bytes);
        signed = { file: 'wuffle-log.csv', alg: a.alg, sig: a.sig, pub: a.pub, hash: a.hash, security: a.security, signedAt: new Date().toISOString() };
        await shell.publish('wuffle-log.csv.sig', new TextEncoder().encode(JSON.stringify(signed, null, 1)),
          { collection: 'Downloads', mime: 'application/json' });
      } catch (e) { /* no attest in this build, or the keystore refused — the log is still published */ }
      // the station photos go to Pictures beside the log
      let nPhotos = 0;
      for (const m of log) {
        const blob = m.photo && photos.get(m.i);
        if (!blob) continue;
        try { await shell.publish(m.photo, new Uint8Array(await blob.arrayBuffer()), { collection: 'Pictures', mime: 'image/jpeg' }); nPhotos++; }
        catch (e) { /* the log is still published */ }
      }
      lastPublish = { name: 'wuffle-log.csv', bytes, signed, photos: nPhotos };
      msg('published ' + log.length + ' → Downloads/wuffle-log.csv' + (signed ? ' + .sig (' + signed.security + ')' : ' (unsigned)') + (nPhotos ? ' + ' + nPhotos + ' photo' + (nPhotos === 1 ? '' : 's') + ' → Pictures' : ''));
    } catch (e) { msg('publish failed: ' + e, true); }
  } else {
    // desktop: a plain download (two homes, one file)
    const a = document.createElement('a'); a.href = csv; a.download = 'wuffle-log.csv'; a.click();
    for (const m of log) {                       // desktop: each photo downloads beside the csv
      const blob = m.photo && photos.get(m.i); if (!blob) continue;
      const u = URL.createObjectURL(blob); const b = document.createElement('a'); b.href = u; b.download = m.photo; b.click();
      setTimeout(() => URL.revokeObjectURL(u), 10000);
    }
    msg('downloaded wuffle-log.csv (' + log.length + ' measurements)');
  }
};

function msg(t, warn) { const m = $('msg'); m.textContent = t; m.className = warn ? 'warn' : ''; }

setMode('plane');
$('brandsub').textContent = shell.present ? 'compass · magnetic N' : 'stereonet · manual';
msg(shell.present ? 'lead-acid ready · lay the phone on a surface to measure'
                  : 'desktop · type measurements above, or open in lead-acid for live compass');

// programmatic hook — the smoke test and headless use plot through this;
// `shell` is exposed so the bench smoke can exercise the mocked native layer.
window.__wuffle = {
  plot: (d1, d2, m) => record(d1, d2, m), log, count: () => log.length, shell,
  get source() { return source; }, get accuracy() { return accuracy; }, get reading() { return cur; },
  get lastPublish() { return lastPublish; }, get fix() { return lastFix; },
  photos, openCamera, snapPhoto, closeCamera, get lastShot() { return lastShot; },
};
