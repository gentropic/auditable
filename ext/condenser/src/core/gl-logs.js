// @gcu/condenser — LOG TRACKS on drillholes: any number of value tracks per hole, like the
// tracks of a downhole log. Each track is a RIBBON beside the trace, one quad per interval:
// it runs from the interval's start to its end along the hole and, across, from `offset`
// out to `offset + width · t` (a bar: t = the value on the track's scale) or the whole
// `width` (a strip: coloured by the value — a lithology, a numeric ramp). The ribbon is a
// BILLBOARD: it lies in the plane of the hole's axis and the screen, so it faces the viewer
// in 3D and faces the screen in a section; its side (left / right / centre) is the
// SCREEN's, so a track stays on its side however the hole runs.
//
// No new data path: a track draws the sticks chunk's own segment + record buffers (instanced,
// the same slices the sticks draw this frame — it accumulates and converges with them), and
// reads its value from a per-record R32F texture (8192-wide, NaN = blank: not drawn). The
// sticks' filter (isolate) and section cull apply. Opaque, depth-tested, depth-writing.

import { makeProgram } from './gl-util.js';

export const LOG_KINDS = ['bar', 'strip'];

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA;
layout(location=1) in vec3 aB;
layout(location=4) in uint aRec;
uniform mat4 uViewProj;
uniform vec3 uEye, uFwd, uRight, uUp;
uniform float uOrtho;
uniform sampler2D uVal;                 // the track's value by record (R32F, 8192-wide; NaN = blank)
uniform vec2 uScale;                    // [lo, span] — t = (v − lo) / span
uniform float uOffset, uWidth;          // world units across the ribbon
uniform float uSide;                    // +1 screen-right · −1 screen-left · 0 centred on the trace
uniform int uKind;                      // 0 bar (width ∝ t) · 1 strip (full width, coloured by t / code)
uniform int uColorBy;                   // 0 solid uColor · 1 ramp by t · 2 palette by code (v = code)
uniform vec3 uColor;
uniform sampler2D uLut;                 // the ramp (256) or the palette (256)
uniform sampler2D uMask;
uniform float uFilterOn, uIsolate;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
flat out vec4 vColor;
flat out float vCull;
void main() {
  int r = int(aRec);
  float v = texelFetch(uVal, ivec2(r & 8191, r >> 13), 0).r;
  vCull = (v != v) ? 1.0 : 0.0;                          // a blank: no ribbon
  if (uFilterOn > 0.5 && uIsolate > 0.5 && texelFetch(uMask, ivec2(r & 8191, r >> 13), 0).r < 0.5) vCull = 1.0;
  vec3 center = (aA + aB) * 0.5, axis = aB - aA;
  float len = max(length(axis), 1e-6);
  vec3 u = axis / len;
  if (uSecCfg.x > 0.5 && abs(dot(center, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y + abs(dot(axis, uSecPlane.xyz)) * 0.5) vCull = 1.0;
  vec3 viewDir = uOrtho > 0.5 ? uFwd : normalize(center - uEye);
  vec3 s = cross(u, viewDir);
  float sl = length(s);
  s = sl > 1e-4 ? s / sl : uRight;                       // a hole seen end-on: any screen direction
  float sr = dot(s, uRight);
  if (abs(sr) > 0.2 ? sr < 0.0 : dot(s, uUp) < 0.0) s = -s;   // the SCREEN's right, whichever way the hole runs
  float t = clamp((v - uScale.x) / max(uScale.y, 1e-12), 0.0, 1.0);
  float a0, a1;                                          // across: from a0 to a1 (signed, world units)
  if (uSide == 0.0) { a0 = uOffset - uWidth * 0.5; a1 = uOffset + uWidth * 0.5; }
  else { float w = uKind == 0 ? uWidth * t : uWidth; a0 = uSide * uOffset; a1 = uSide * (uOffset + w); }
  if (abs(a1 - a0) < 1e-9) vCull = 1.0;                  // a zero bar draws nothing
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec3 wp = mix(aA, aB, corner.x) + s * mix(a0, a1, corner.y);
  gl_Position = uViewProj * vec4(wp, 1.0);
  if (uColorBy == 0) vColor = vec4(uColor, 1.0);
  else if (uColorBy == 1) vColor = vec4(texture(uLut, vec2(t, 0.5)).rgb, 1.0);
  else vColor = vec4(texture(uLut, vec2((v + 0.5) / 256.0, 0.5)).rgb, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
flat in vec4 vColor;
flat in float vCull;
out vec4 outColor;
void main() {
  if (vCull > 0.5) discard;
  outColor = vColor;
}`;

const W = 8192;

export function createLogsPipeline(gl) {
  const prog = makeProgram(gl, VERT, FRAG);
  const U = (n) => gl.getUniformLocation(prog, n);
  const u = {
    viewProj: U('uViewProj'), eye: U('uEye'), fwd: U('uFwd'), right: U('uRight'), up: U('uUp'), ortho: U('uOrtho'),
    val: U('uVal'), scale: U('uScale'), offset: U('uOffset'), width: U('uWidth'), side: U('uSide'), kind: U('uKind'),
    colorBy: U('uColorBy'), color: U('uColor'), lut: U('uLut'), mask: U('uMask'), filterOn: U('uFilterOn'), isolate: U('uIsolate'),
    secPlane: U('uSecPlane'), secCfg: U('uSecCfg'),
  };
  const sets = new Map();                                  // layer → [{ tex, lut, kind, side, offset, width, scale, colorBy, color }]
  const vaos = new Map();                                  // sticks chunk → its track VAO (segments + records only)

  const freeSet = (list) => { for (const t of list || []) { gl.deleteTexture(t.tex); if (t.lut) gl.deleteTexture(t.lut); } };
  function valueTexture(values) {
    const n = values.length, H = Math.max(1, Math.ceil(n / W)), data = new Float32Array(W * H).fill(NaN);
    data.set(values);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, H, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }
  function lutTexture(px, nearest) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const f = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    return t;
  }
  // a layer's tracks, all at once (null / [] = none). Each: { values: Float32Array by record
  // (NaN = blank), kind 'bar' | 'strip', side 'left' | 'right' | 'center', offset, width (world),
  // range [lo, hi], color [r, g, b] 0..1, ramp: Uint8Array(1024) | null (colour by value),
  // palette: Uint8Array(1024) | null (values ARE codes 0..255 — a class strip) }
  function set(layer, tracks) {
    freeSet(sets.get(layer)); sets.delete(layer);
    if (!tracks || !tracks.length) return;
    sets.set(layer, tracks.map((tr) => {
      const lo = tr.range ? +tr.range[0] : 0, hi = tr.range ? +tr.range[1] : 1;
      return {
        tex: valueTexture(tr.values), lut: tr.palette ? lutTexture(tr.palette, true) : tr.ramp ? lutTexture(tr.ramp, false) : null,
        kind: tr.kind === 'strip' ? 1 : 0, side: tr.side === 'left' ? -1 : tr.side === 'center' ? 0 : 1,
        offset: +tr.offset || 0, width: +tr.width || 1, scale: [lo, hi > lo ? hi - lo : 1],
        colorBy: tr.palette ? 2 : tr.ramp ? 1 : 0, color: tr.color || [0.85, 0.55, 0.2],
      };
    }));
  }
  const has = (layer) => sets.has(layer);
  // draw `layer`'s tracks over the chunk slices the sticks drew ([chunk, first, k]), with the
  // layer's camera state `s` and its gates (mask / isolate / section)
  function draw(layer, slices, s, { maskTex = null, isolate = false, section = null } = {}) {
    const list = sets.get(layer); if (!list || !slices.length) return;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(u.viewProj, false, s.viewProj);
    gl.uniform3f(u.eye, s.eye[0], s.eye[1], s.eye[2]);
    const v = s.view;
    gl.uniform3f(u.right, v[0], v[4], v[8]); gl.uniform3f(u.up, v[1], v[5], v[9]);
    const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]], fl = Math.hypot(...f) || 1;
    gl.uniform3f(u.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
    gl.uniform1f(u.ortho, s.ortho ? 1 : 0);
    gl.uniform1f(u.filterOn, maskTex ? 1 : 0); gl.uniform1f(u.isolate, isolate ? 1 : 0);
    if (maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(u.mask, 4); }
    gl.uniform4f(u.secPlane, section ? section.n[0] : 0, section ? section.n[1] : 0, section ? section.n[2] : 1, section ? section.d : 0);
    gl.uniform2f(u.secCfg, section ? 1 : 0, section ? section.half : 0);
    for (const tr of list) {
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tr.tex); gl.uniform1i(u.val, 2);
      if (tr.lut) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tr.lut); gl.uniform1i(u.lut, 3); }
      gl.uniform2f(u.scale, tr.scale[0], tr.scale[1]);
      gl.uniform1f(u.offset, tr.offset); gl.uniform1f(u.width, tr.width); gl.uniform1f(u.side, tr.side);
      gl.uniform1i(u.kind, tr.kind); gl.uniform1i(u.colorBy, tr.colorBy);
      gl.uniform3f(u.color, tr.color[0], tr.color[1], tr.color[2]);
      for (const [c, first, k] of slices) {
        const src = c._src || c;                           // a view's proxy draws its source's buffers
        let vao = vaos.get(src);
        if (!vao) { vao = gl.createVertexArray(); vaos.set(src, vao); }
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, src.bSeg);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, first * 24); gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, first * 24 + 12); gl.vertexAttribDivisor(1, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, src.bRec);
        gl.enableVertexAttribArray(4); gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, first * 4); gl.vertexAttribDivisor(4, 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
      }
    }
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);
  }
  // the furthest a layer's ribbons reach from the trace (world) — the chunk cull pads by it
  const reach = (layer) => { const list = sets.get(layer); return list ? Math.max(0, ...list.map((t) => Math.abs(t.offset) + t.width)) : 0; };
  // a chunk going (its layer removed, re-streamed): its track VAO goes with it
  function forget(chunk) { const v = vaos.get(chunk); if (v) { gl.deleteVertexArray(v); vaos.delete(chunk); } }
  return {
    set, has, draw, reach, forget,
    drop(layer) { freeSet(sets.get(layer)); sets.delete(layer); },
    clear() { for (const k of [...sets.keys()]) { freeSet(sets.get(k)); sets.delete(k); } for (const v of vaos.values()) gl.deleteVertexArray(v); vaos.clear(); },
  };
}
