// @gcu/condenser — PROJECTIONS: maximum / minimum / mean intensity along the line
// of sight. Per pixel, the largest (smallest, average) NORMALIZED value of every
// element the ray crosses — occlusion ignored — mapped through the layer's ramp.
// "Where are the high grades, through the whole model."
//
// Mechanism: each projected layer draws its elements (the same programs as the
// normal raster, built with `#define MIP`: same culling — section, filter, class
// eyes, hidden ramp classes — but the fragment writes the record's normalized value
// instead of a colour) into its OWN offscreen target, depth test off, blended:
//   max   blendEquation(MAX)                 R16F, cleared to −1 (nothing hit)
//   min   blendEquation(MIN)                 R16F, cleared to  2 (nothing hit)
//   mean  additive (ONE, ONE): R = Σt, G = n RG32F (EXT_float_blend) or RG16F
// Without float colour buffers (EXT_color_buffer_float), max/min fall back to RGBA8
// — 256 levels, plenty for a 256-texel ramp — with ALPHA as the hit flag
// (blendEquationSeparate(MIN, MAX) for min); mean is not offered there (8-bit sums
// saturate at 255). "Nothing hit" is never value 0: the sentinel / flag says it.
//
// Then ONE fullscreen pass per projected layer maps the target through the ramp
// into the frame being drawn (the EDL target); pixels nothing hit are left alone
// (the rest of the scene — meshes, drillholes, layers coloured by category — drew
// there normally). Targets ACCUMULATE across still frames exactly as the raster
// does (each chunk's next slice blends in), so the projection converges with it;
// a moving frame clears them.

import { makeProgram } from './gl-util.js';

export const PROJECTION_MODES = ['max', 'min', 'mean'];

const QUAD_VERT = `#version 300 es
precision highp float;
void main() {                          // fullscreen triangle, no buffers
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// decode: 0 = float max (hit: R ≥ 0) · 1 = float min (hit: R ≤ 1) · 2 = 8-bit (hit: A) · 3 = mean (R / G)
const COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uAcc;
uniform sampler2D uRamp;
uniform int uDecode;
out vec4 outColor;
void main() {
  vec4 a = texelFetch(uAcc, ivec2(gl_FragCoord.xy), 0);
  float t = a.r;
  bool hit;
  if (uDecode == 0) hit = a.r >= 0.0;
  else if (uDecode == 1) hit = a.r <= 1.0;
  else if (uDecode == 2) hit = a.a > 0.5;
  else { hit = a.g > 0.5; t = hit ? a.r / a.g : 0.0; }
  if (!hit) discard;
  outColor = vec4(texture(uRamp, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb, 1.0);
}`;

/** The JS side of the decode — one place, shared by the readbacks. → t in 0..1, or null (nothing hit). */
export function decodeProjection(decode, r, g, a) {
  if (decode === 0) return r >= 0 ? r : null;
  if (decode === 1) return r <= 1 ? r : null;
  if (decode === 2) return a > 0.5 ? r : null;
  return g > 0.5 ? r / g : null;
}

export function createMipPipeline(gl) {
  const cbf = !!gl.getExtension('EXT_color_buffer_float');
  const floatBlend = !!gl.getExtension('EXT_float_blend');
  const comp = makeProgram(gl, QUAD_VERT, COMPOSITE_FRAG);
  const uAcc = gl.getUniformLocation(comp, 'uAcc'), uRamp = gl.getUniformLocation(comp, 'uRamp'), uDecode = gl.getUniformLocation(comp, 'uDecode');
  const targets = new Map();                               // layer → { tex, fbo, w, h, fmt, mode }

  // does this internal format render (and attach completely) here? probed once each
  const probed = new Map();
  function renders(fmt) {
    if (probed.has(fmt.key)) return probed.get(fmt.key);
    const t = gl.createTexture(), f = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.ifmt, 4, 4, 0, fmt.fmt, fmt.type, null);
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    gl.deleteFramebuffer(f); gl.deleteTexture(t);
    probed.set(fmt.key, ok);
    return ok;
  }
  const F = {
    r16f: { key: 'r16f', ifmt: gl.R16F, fmt: gl.RED, type: gl.HALF_FLOAT, float: true, bits: 'half float (R16F)' },
    rg16f: { key: 'rg16f', ifmt: gl.RG16F, fmt: gl.RG, type: gl.HALF_FLOAT, float: true, bits: 'half float (RG16F)' },
    rg32f: { key: 'rg32f', ifmt: gl.RG32F, fmt: gl.RG, type: gl.FLOAT, float: true, bits: 'float (RG32F)' },
    rgba8: { key: 'rgba8', ifmt: gl.RGBA8, fmt: gl.RGBA, type: gl.UNSIGNED_BYTE, float: false, bits: '8-bit (256 levels)' },
  };
  // the target format a mode uses here, or null (not offered on this GPU)
  function formatFor(mode) {
    if (mode === 'mean') {
      if (cbf && floatBlend && renders(F.rg32f)) return F.rg32f;
      if (cbf && renders(F.rg16f)) return F.rg16f;
      return null;
    }
    if (cbf && renders(F.r16f)) return F.r16f;
    return F.rgba8;
  }
  const decodeOf = (mode, fmt) => (mode === 'mean' ? 3 : !fmt.float ? 2 : mode === 'max' ? 0 : 1);

  function drop(layer) {
    const t = targets.get(layer);
    if (!t) return;
    gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex);
    targets.delete(layer);
  }

  // Bind `layer`'s target for drawing in `mode`, at w×h: (re)allocated — and cleared —
  // when new, resized or the mode changed; cleared too when `clear` (a moving frame).
  // Leaves the blend state set for the mode; end() puts it back.
  function begin(layer, mode, w, h, clear) {
    const fmt = formatFor(mode);
    if (!fmt) throw new Error(`condenser: the ${mode} projection needs float render targets, which this GPU does not offer`);
    let t = targets.get(layer);
    let fresh = false;
    if (!t || t.w !== w || t.h !== h || t.fmt !== fmt) {
      drop(layer);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.ifmt, w, h, 0, fmt.fmt, fmt.type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      t = { tex, fbo, w, h, fmt, mode };
      targets.set(layer, t);
      fresh = true;
    }
    if (t.mode !== mode) { t.mode = mode; fresh = true; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, w, h);
    if (fresh || clear) {
      if (mode === 'max') gl.clearColor(fmt.float ? -1 : 0, 0, 0, 0);
      else if (mode === 'min') gl.clearColor(fmt.float ? 2 : 1, 1, 1, 0);
      else gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    if (mode === 'max') gl.blendEquation(gl.MAX);
    else if (mode === 'min') gl.blendEquationSeparate(gl.MIN, gl.MAX);   // alpha (the 8-bit hit flag) only ever rises
    else { gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE); }
  }
  function end() {
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ZERO);
  }
  // map `layer`'s target through `ramp` into the CURRENT framebuffer (depth test off,
  // nothing-hit pixels untouched). The caller restores its own depth state.
  function composite(layer, ramp) {
    const t = targets.get(layer);
    if (!t) return;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(comp);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(uAcc, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ramp); gl.uniform1i(uRamp, 3);
    gl.uniform1i(uDecode, decodeOf(t.mode, t.fmt));
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);   // a later pass may render into it
  }
  // read a rect of `layer`'s target → decoded t per pixel (NaN = nothing hit), rows bottom-up
  function read(layer, x = 0, y = 0, w = null, h = null) {
    const t = targets.get(layer);
    if (!t) return null;
    w = w == null ? t.w : w; h = h == null ? t.h : h;
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const n = w * h, out = new Float32Array(n), dec = decodeOf(t.mode, t.fmt);
    if (t.fmt.float) {
      const px = new Float32Array(n * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, px);
      for (let i = 0; i < n; i++) { const v = decodeProjection(dec, px[i * 4], px[i * 4 + 1], px[i * 4 + 3]); out[i] = v == null ? NaN : v; }
    } else {
      const px = new Uint8Array(n * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < n; i++) { const v = decodeProjection(dec, px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 3] / 255); out[i] = v == null ? NaN : v; }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    return { data: out, w, h, format: t.fmt.key, mode: t.mode };
  }
  return {
    begin, end, composite, read, drop,
    clear() { for (const id of [...targets.keys()]) drop(id); },
    has: (layer) => targets.has(layer),
    // what this GPU offers: per mode, the target format (null = not offered)
    support() { const o = {}; for (const m of PROJECTION_MODES) { const f = formatFor(m); o[m] = f ? { format: f.key, bits: f.bits, float: f.float } : null; } return o; },
    supports: (mode) => !!formatFor(mode),
  };
}
