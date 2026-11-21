// SVG from a draw list (spec §10). `toSVG(list)` walks the ops fig.toDrawList() makes and writes
// what a canvas would have painted: paths as `d` strings, text as <text> in the theme's font,
// the raster op as an embedded PNG, clipping as <clipPath>. It reads only the list, so it is the
// same in every host, and the same list always gives the same SVG, byte for byte.
//
// The canvas transform is applied to coordinates as they are added (as a canvas does), so the
// output has no nested transforms except on text and images. plot only ever translates,
// rotates and scales uniformly; arcs assume that (a skewed arc would come out circular).
//
// Big scatters are rasters in the list (one `image` op), and stay rasters in the SVG: an honest
// picture of a million points, small, not a million <circle>s.

import { encodePNG } from './png.js';
import { parseColorBytes } from './record.js';

const _svgNum = (v) => { const s = (Math.round(v * 100) / 100).toString(); return s === '-0' ? '0' : s; };
const _svgEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// a paint: [colour, opacity] — rgba() split, so every SVG reader gets it
function _svgPaint(c) {
  if (c == null || c === 'none' || c === 'transparent') return ['none', 0];
  const b = parseColorBytes(String(c).replace(/\s+/g, ''));
  if (!b) return [String(c), 1];
  const hex = '#' + [b[0], b[1], b[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return [hex, b[3] / 255];
}

const _SVG_ANCHOR = { center: 'middle', right: 'end', end: 'end', left: 'start', start: 'start' };
const _SVG_BASELINE = { top: 'text-before-edge', hanging: 'hanging', middle: 'central', bottom: 'text-after-edge', ideographic: 'ideographic', alphabetic: 'alphabetic' };

function _svgFont(f) {
  const m = /^\s*(?:(italic|oblique)\s+)?(?:(normal|bold|bolder|lighter|[1-9]00)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/.exec(f || '');
  if (!m) return { size: 10, family: 'sans-serif', weight: null, style: null };
  return { style: m[1] || null, weight: m[2] && m[2] !== 'normal' ? m[2] : null, size: +m[3], family: m[4].trim() };
}

function _b64bytes(b64) {
  if (typeof atob === 'function') { const s = atob(b64), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}
function _bytesB64(bytes) {
  if (typeof btoa === 'function') { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  return Buffer.from(bytes).toString('base64');
}

export function toSVG(list, opts) {
  const o = opts || {};
  if (!list || !Array.isArray(list.ops)) throw new TypeError('toSVG: expected a draw list (fig.toDrawList())');
  const W = list.width, H = list.height;
  const DEF = { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter', lineDashOffset: 0 };
  let st = { ...DEF, m: [1, 0, 0, 1, 0, 0], dash: [], clip: null };
  const stack = [];
  const defs = [], body = [];
  let clipN = 0, group = null;
  let path = [], cur = null, start = null;

  const T = (x, y) => { const m = st.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };
  const scaleOf = () => Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2]));
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const pt = (p) => `${_svgNum(p[0])} ${_svgNum(p[1])}`;
  const emit = (el) => {
    // consecutive elements under one clip share a group
    if (group !== st.clip) { if (group) body.push('</g>'); group = st.clip; if (group) body.push(`<g clip-path="url(#${group})">`); }
    body.push(el);
  };
  const alpha = (a) => (a < 1 ? ` opacity="${_svgNum(a * 1000) / 1000}"` : '');
  const d = () => path.join('');

  const arc = (x, y, r, a0, a1, ccw) => {
    const TAU = 2 * Math.PI;
    let sweep = ccw ? a0 - a1 : a1 - a0;
    const full = sweep >= TAU - 1e-9 || sweep <= -TAU + 1e-9;
    if (!full) { sweep %= TAU; if (sweep < 0) sweep += TAU; }
    const at = (a) => T(x + r * Math.cos(a), y + r * Math.sin(a));
    const S = at(a0);
    // a canvas joins the arc to the current point; already there (a marker's moveTo), no join
    if (!cur) { path.push(`M${pt(S)}`); start = S; }
    else if (_svgNum(cur[0]) !== _svgNum(S[0]) || _svgNum(cur[1]) !== _svgNum(S[1])) path.push(`L${pt(S)}`);
    const R = _svgNum(r * scaleOf());
    let flag = ccw ? 0 : 1;
    if (st.m[0] * st.m[3] - st.m[1] * st.m[2] < 0) flag = 1 - flag;
    const dir = ccw ? -1 : 1;
    if (full) {
      const M = at(a0 + dir * Math.PI);
      path.push(`A${R} ${R} 0 0 ${flag} ${pt(M)}A${R} ${R} 0 0 ${flag} ${pt(S)}`);
      cur = S;
    } else {
      const E = at(a0 + dir * sweep);
      path.push(`A${R} ${R} 0 ${sweep > Math.PI ? 1 : 0} ${flag} ${pt(E)}`);
      cur = E;
    }
  };

  for (const op of list.ops) {
    const [name, ...a] = op;
    switch (name) {
      case 'set': st[a[0]] = a[1]; break;
      case 'save': stack.push({ ...st, m: st.m.slice(), dash: st.dash.slice() }); break;
      case 'restore': if (stack.length) st = stack.pop(); break;
      case 'setLineDash': st.dash = Array.from(a[0] || []); break;
      case 'translate': st.m = mul(st.m, [1, 0, 0, 1, a[0], a[1]]); break;
      case 'scale': st.m = mul(st.m, [a[0], 0, 0, a[1], 0, 0]); break;
      case 'rotate': { const c = Math.cos(a[0]), s = Math.sin(a[0]); st.m = mul(st.m, [c, s, -s, c, 0, 0]); break; }
      case 'transform': st.m = mul(st.m, a); break;
      case 'setTransform': st.m = a.length === 6 ? a.slice() : [1, 0, 0, 1, 0, 0]; break;
      case 'resetTransform': st.m = [1, 0, 0, 1, 0, 0]; break;
      case 'beginPath': path = []; cur = start = null; break;
      case 'moveTo': { const p = T(a[0], a[1]); path.push(`M${pt(p)}`); cur = start = p; break; }
      case 'lineTo': { const p = T(a[0], a[1]); path.push(cur ? `L${pt(p)}` : `M${pt(p)}`); if (!cur) start = p; cur = p; break; }
      case 'closePath': if (cur) { path.push('Z'); cur = start; } break;
      case 'rect': {
        const [x, y, w, h] = a, P = [T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)];
        path.push(`M${pt(P[0])}L${pt(P[1])}L${pt(P[2])}L${pt(P[3])}Z`); cur = start = P[0]; break;
      }
      case 'arc': arc(a[0], a[1], a[2], a[3], a[4], !!a[5]); break;
      case 'ellipse': {
        // sampled: plot draws no ellipse today; a polyline keeps any that come exact enough
        const [x, y, rx, ry, rot, a0, a1, ccw] = a, N = 64;
        let sw = ccw ? a0 - a1 : a1 - a0; if (sw < 0) sw += 2 * Math.PI;
        for (let k = 0; k <= N; k++) {
          const t = a0 + (ccw ? -1 : 1) * (sw * k) / N, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
          const p = T(x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot));
          path.push(cur ? `L${pt(p)}` : `M${pt(p)}`); if (!cur) start = p; cur = p;
        }
        break;
      }
      case 'quadraticCurveTo': { const c = T(a[0], a[1]), p = T(a[2], a[3]); path.push(`Q${pt(c)} ${pt(p)}`); cur = p; break; }
      case 'bezierCurveTo': { const c1 = T(a[0], a[1]), c2 = T(a[2], a[3]), p = T(a[4], a[5]); path.push(`C${pt(c1)} ${pt(c2)} ${pt(p)}`); cur = p; break; }
      case 'arcTo': { const p = T(a[2], a[3]); path.push(cur ? `L${pt(p)}` : `M${pt(p)}`); cur = p; break; }
      case 'fill': {
        if (!path.length) break;
        const [c, op_] = _svgPaint(st.fillStyle);
        if (c === 'none') break;
        const rule = a[0] === 'evenodd' ? ' fill-rule="evenodd"' : '';
        emit(`<path d="${d()}" fill="${c}"${rule}${alpha(op_ * st.globalAlpha)}/>`);
        break;
      }
      case 'stroke': {
        if (!path.length) break;
        const el = _svgStroke(`<path d="${d()}" fill="none"`, st, scaleOf());
        if (el) emit(el);
        break;
      }
      case 'fillRect': case 'strokeRect': {
        const [x, y, w, h] = a, m = st.m;
        const fill = name === 'fillRect';
        const [c, op_] = _svgPaint(fill ? st.fillStyle : st.strokeStyle);
        if (c === 'none' || !(w && h)) break;
        let geom;
        if (m[1] === 0 && m[2] === 0) {
          const p = T(x, y), q = T(x + w, y + h);
          geom = `<rect x="${_svgNum(Math.min(p[0], q[0]))}" y="${_svgNum(Math.min(p[1], q[1]))}" width="${_svgNum(Math.abs(q[0] - p[0]))}" height="${_svgNum(Math.abs(q[1] - p[1]))}"`;
        } else {
          const P = [T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)];
          geom = `<path d="M${pt(P[0])}L${pt(P[1])}L${pt(P[2])}L${pt(P[3])}Z"`;
        }
        if (fill) emit(`${geom} fill="${c}"${alpha(op_ * st.globalAlpha)}/>`);
        else { const el = _svgStroke(`${geom} fill="none"`, st, scaleOf()); if (el) emit(el); }
        break;
      }
      case 'clearRect': break;   // nothing under an SVG to clear; the figure paints its own face
      case 'clip': {
        if (!path.length) break;
        const id = `${o.idPrefix || 'p'}c${++clipN}`;
        const nest = st.clip ? ` clip-path="url(#${st.clip})"` : '';
        defs.push(`<clipPath id="${id}"${nest}><path d="${d()}"${a[0] === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
        st.clip = id;
        break;
      }
      case 'fillText': case 'strokeText': {
        const [s, x, y] = a;
        if (s == null || s === '') break;
        const f = _svgFont(st.font), p = T(x, y), k = scaleOf();
        const ang = Math.atan2(st.m[1], st.m[0]) * 180 / Math.PI;
        const fill = name === 'fillText';
        const [c, op_] = _svgPaint(fill ? st.fillStyle : st.strokeStyle);
        if (c === 'none') break;
        let el = `<text x="${_svgNum(p[0])}" y="${_svgNum(p[1])}" font-family="${_svgEsc(f.family.replace(/"/g, "'"))}" font-size="${_svgNum(f.size * k)}"`;
        if (f.weight) el += ` font-weight="${f.weight}"`;
        if (f.style) el += ` font-style="${f.style}"`;
        const an = _SVG_ANCHOR[st.textAlign] || 'start';
        if (an !== 'start') el += ` text-anchor="${an}"`;
        const bl = _SVG_BASELINE[st.textBaseline] || 'alphabetic';
        if (bl !== 'alphabetic') el += ` dominant-baseline="${bl}"`;
        if (Math.abs(ang) > 1e-6) el += ` transform="rotate(${_svgNum(ang)} ${_svgNum(p[0])} ${_svgNum(p[1])})"`;
        if (fill) el += ` fill="${c}"${alpha(op_ * st.globalAlpha)}`;
        else el += ` fill="none" stroke="${c}" stroke-width="${_svgNum(st.lineWidth * k)}" stroke-linejoin="round"${alpha(op_ * st.globalAlpha)}`;
        emit(`${el}>${_svgEsc(s)}</text>`);
        break;
      }
      case 'image': {
        const [x, y, w, h, cols, rows, b64] = a;
        const png = encodePNG(_b64bytes(b64), cols, rows);
        const m = st.m, ident = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
        const tf = ident ? '' : ` transform="matrix(${m.map(_svgNum).join(' ')})"`;
        emit(`<image x="${_svgNum(x)}" y="${_svgNum(y)}" width="${_svgNum(w)}" height="${_svgNum(h)}" preserveAspectRatio="none" style="image-rendering:pixelated"${tf}${alpha(st.globalAlpha)} href="data:image/png;base64,${_bytesB64(png)}"/>`);
        break;
      }
      default: throw new Error(`toSVG: unknown op '${name}'`);
    }
  }
  if (group) body.push('</g>');
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${_svgNum(W)}" height="${_svgNum(H)}" viewBox="0 0 ${_svgNum(W)} ${_svgNum(H)}">`;
  // an export's face, under everything (Figure.toSVG passes the theme's background when the
  // figure has none of its own)
  const [fc, fo] = _svgPaint(o.facecolor);
  const face = fc !== 'none' ? `<rect width="${_svgNum(W)}" height="${_svgNum(H)}" fill="${fc}"${fo < 1 ? ` opacity="${_svgNum(fo * 1000) / 1000}"` : ''}/>\n` : '';
  return `${head}\n${defs.length ? `<defs>${defs.join('')}</defs>\n` : ''}${face}${body.join('\n')}\n</svg>\n`;
}

function _svgStroke(open, st, k) {
  const [c, op_] = _svgPaint(st.strokeStyle);
  if (c === 'none') return '';
  let el = `${open} stroke="${c}" stroke-width="${_svgNum(st.lineWidth * k)}"`;
  if (st.lineCap !== 'butt') el += ` stroke-linecap="${st.lineCap}"`;
  if (st.lineJoin !== 'miter') el += ` stroke-linejoin="${st.lineJoin}"`;
  if (st.dash.length) el += ` stroke-dasharray="${st.dash.map((v) => _svgNum(v * k)).join(' ')}"`;
  if (st.dash.length && st.lineDashOffset) el += ` stroke-dashoffset="${_svgNum(st.lineDashOffset * k)}"`;
  if (op_ * st.globalAlpha < 1) el += ` opacity="${_svgNum(op_ * st.globalAlpha * 1000) / 1000}"`;
  return el + '/>';
}
