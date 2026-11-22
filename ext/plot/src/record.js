// Figures as data: a recording 2D context and its replay.
//
// `recordingContext(w, h)` stands in for a CanvasRenderingContext2D. Every call plot makes on
// it becomes one plain-JSON op, `[name, ...args]`, and every property assignment becomes
// `['set', name, value]`. `replay(ctx, list)` plays the ops back on a real context. Nothing here
// touches the DOM, so a figure can be drawn in a worker or Node and shown somewhere else.
//
// Text widths: every font plot uses is monospace, so `measureText(s)` answers
// s.length × 0.6 × px. That keeps layout identical in every host, Node included.
//
// Ops whose numeric arguments are not finite are dropped, which is what a canvas does with
// them anyway (and JSON could not carry NaN).
//
// One op is not a canvas call: `['image', x, y, w, h, cols, rows, rgbaBase64]`, a whole
// colour-mapped raster (imshow) in one op instead of one fillRect per cell.

const _METHODS = new Set([
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect',
  'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'fillRect',
  'strokeRect', 'clearRect', 'fillText', 'strokeText', 'translate', 'rotate', 'scale',
  'transform', 'setTransform', 'resetTransform', 'setLineDash',
]);

const _DEFAULTS = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, font: '10px sans-serif',
  textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1, lineCap: 'butt',
  lineJoin: 'miter', lineDashOffset: 0, imageSmoothingEnabled: true,
};

function _fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return m ? +m[1] : 10;
}

function _finiteArgs(args) {
  for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) return false;
  return true;
}

export function recordingContext(width, height) {
  const ops = [];
  let state = { ..._DEFAULTS };
  let dash = [];
  const stack = [];
  const target = {
    _plotRecorder: true,
    ops,
    canvas: { width, height },
    measureText(s) {
      return { width: String(s).length * 0.6 * _fontPx(state.font) };
    },
    getLineDash() { return dash.slice(); },
    // the raster op (see the header)
    // `holder` (optional) keeps the encoding between draws of the same raster
    _image(x, y, w, h, cols, rows, rgba, holder) {
      if (!_finiteArgs([x, y, w, h])) return;
      let b64;
      if (holder && holder.b64Of === rgba) b64 = holder.b64;
      else { b64 = _toBase64(rgba); if (holder) { holder.b64Of = rgba; holder.b64 = b64; } }
      ops.push(['image', x, y, w, h, cols, rows, b64]);
    },
  };
  return new Proxy(target, {
    get(t, name) {
      if (name in t) return t[name];
      if (typeof name === 'string' && _METHODS.has(name)) {
        return (...args) => {
          if (name === 'save') stack.push({ state: { ...state }, dash: dash.slice() });
          if (name === 'restore' && stack.length) { const s = stack.pop(); state = s.state; dash = s.dash; }
          if (name === 'setLineDash') { dash = Array.from(args[0] || []); ops.push(['setLineDash', dash.slice()]); return; }
          if (!_finiteArgs(args)) return;
          ops.push([name, ...args]);
        };
      }
      return state[name];
    },
    set(t, name, value) {
      state[name] = value;
      ops.push(['set', name, value]);
      return true;
    },
  });
}

export function isRecordingContext(ctx) {
  return !!(ctx && ctx._plotRecorder);
}

// Play a draw list back on a real 2D context.
export function replay(ctx, list) {
  const ops = Array.isArray(list) ? list : list && list.ops;
  if (!Array.isArray(ops)) throw new TypeError('replay: expected a draw list (fig.toDrawList()) or its ops');
  for (const op of ops) {
    const [name, ...args] = op;
    if (name === 'set') { ctx[args[0]] = args[1]; continue; }
    if (name === 'image') { (ctx.acceptsImageData ? _replayPixels : _replayImage)(ctx, ...args); continue; }
    if (!_METHODS.has(name)) throw new Error(`replay: unknown op '${name}'`);
    ctx[name](...args);
  }
}

// a context that takes pixels directly (@gcu/pdf's): the raster at its own resolution, unsmoothed
function _replayPixels(ctx, x, y, w, h, cols, rows, b64) {
  const bytes = _fromBase64(b64);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage({ width: cols, height: rows, data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length) }, x, y, w, h);
  ctx.imageSmoothingEnabled = smooth;
}

function _replayImage(ctx, x, y, w, h, cols, rows, b64) {
  const bytes = _fromBase64(b64);
  const make = (cw, ch) => (typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(cw, ch)
    : Object.assign(document.createElement('canvas'), { width: cw, height: ch }));
  const scratch = make(cols, rows);
  const sctx = scratch.getContext('2d');
  sctx.putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length), cols, rows), 0, 0);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, x, y, w, h);
  ctx.imageSmoothingEnabled = smooth;
}

// 'rgb(r,g,b)' / 'rgba(r,g,b,a)' / '#rgb' / '#rrggbb' → [r, g, b, a] bytes, or null
export function parseColorBytes(c) {
  if (typeof c !== 'string') return null;
  let m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 255 : Math.round(+m[4] * 255)];
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
  }
  return null;
}

// Base64 by table into ASCII bytes, decoded to a string once: a raster is megabytes, and
// btoa needs it as one binary string first (a 16 MB image spent most of its draw-list time
// there). Falls back to btoa where TextDecoder is missing.
const _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let _B64PAIRS = null;
function _toBase64(bytes) {
  if (typeof TextDecoder === 'undefined') {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  if (!_B64PAIRS) {
    // every 12-bit value → its two characters, as one 16-bit unit (little-endian bytes)
    _B64PAIRS = new Uint16Array(4096);
    for (let i = 0; i < 4096; i++) _B64PAIRS[i] = _B64.charCodeAt(i >> 6) | (_B64.charCodeAt(i & 63) << 8);
  }
  const n = bytes.length, full = n - (n % 3);
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  const o16 = new Uint16Array(out.buffer);
  let j = 0;
  for (let i = 0; i < full; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    o16[j++] = _B64PAIRS[v >> 12];
    o16[j++] = _B64PAIRS[v & 4095];
  }
  let o = j * 2;
  const rest = n - full;
  if (rest) {
    const v = (bytes[full] << 16) | (rest === 2 ? bytes[full + 1] << 8 : 0);
    out[o++] = _B64.charCodeAt(v >> 18);
    out[o++] = _B64.charCodeAt((v >> 12) & 63);
    out[o++] = rest === 2 ? _B64.charCodeAt((v >> 6) & 63) : 61;   // '='
    out[o++] = 61;
  }
  return new TextDecoder('latin1').decode(out);
}

function _fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
