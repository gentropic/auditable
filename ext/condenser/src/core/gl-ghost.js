// @gcu/condenser — GHOST filter display: the records a filter leaves OUT, drawn as a flat
// shape BEHIND the ones it keeps — never covering them — so the kept blocks read in context
// without the dim mode's muddy, opaque 30 % copy of everything in front of them.
//
// Mechanism: the ghost layer's FILTERED-OUT records draw (the same programs, `uGhost`: keep
// only m < 0.5) into the layer's OWN depth target, slice for slice with the raster, so it
// accumulates and converges with it. Every element the main raster draws (points, blocks,
// sticks — not meshes) marks the stencil 1; one fullscreen pass per ghost layer then draws
// the ghost over the frame where
//   · the ghost target has coverage there,
//   · the stencil is NOT 1 — no kept element is drawn at that pixel, in front or behind,
//   · the ghost is in FRONT of what the frame holds there (depth test, no depth write) —
//     a surface in front of the ghost still hides it; the background never does.
// Two styles:
//   tint    — one flat colour over the ghost's coverage (a faint silhouette fill)
//   outline — only the coverage's BOUNDARY: a thin line round the filtered-out envelope
//             (an edge detect on the ghost depth's coverage, as EDL reads depth). Drawn once
//             the layer has converged — a partial coverage's boundary isn't the envelope's.
// Both write an opaque colour, so a still frame that composites again changes nothing.

import { makeProgram } from './gl-util.js';

export const GHOST_STYLES = ['tint', 'outline'];

const QUAD_VERT = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform highp sampler2D uGDepth;        // the ghost's depth (1 = nothing there)
uniform int uStyle;                     // 0 tint · 1 outline
uniform vec3 uColor;
uniform int uWidth;                     // outline half-width in pixels
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 sz = textureSize(uGDepth, 0);
  float d = texelFetch(uGDepth, p, 0).r;
  if (d >= 1.0) discard;
  if (uStyle == 1) {
    bool edge = false;
    const ivec2 DIRS[8] = ivec2[8](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1), ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1));
    for (int k = 1; k <= 4; k++) {
      if (k > uWidth) break;
      for (int i = 0; i < 8; i++) {
        ivec2 o = DIRS[i] * k;
        ivec2 q = clamp(p + o, ivec2(0), sz - 1);
        if (q != p + o || texelFetch(uGDepth, q, 0).r >= 1.0) edge = true;
      }
    }
    if (!edge) discard;
  }
  gl_FragDepth = d;
  outColor = vec4(uColor, 1.0);
}`;

export function createGhostPipeline(gl) {
  const comp = makeProgram(gl, QUAD_VERT, COMPOSITE_FRAG);
  const U = (n) => gl.getUniformLocation(comp, n);
  const u = { depth: U('uGDepth'), style: U('uStyle'), color: U('uColor'), width: U('uWidth') };
  const targets = new Map();                                 // layer → { fbo, depth, w, h }

  function drop(layer) {
    const t = targets.get(layer); if (!t) return;
    gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.depth);
    targets.delete(layer);
  }
  // bind `layer`'s ghost target at w×h for drawing — (re)allocated and cleared when new or
  // resized, cleared when `clear` (a moving frame). Depth test + write on.
  function begin(layer, w, h, clear) {
    let t = targets.get(layer), fresh = false;
    if (!t || t.w !== w || t.h !== h) {
      drop(layer);
      const depth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      gl.drawBuffers([gl.NONE]);                             // depth only: the coverage IS the depth
      gl.readBuffer(gl.NONE);
      t = { fbo, depth, w, h };
      targets.set(layer, t);
      fresh = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, w, h);
    if (fresh || clear) { gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
  }
  // draw `layer`'s ghost over the CURRENT framebuffer: not where the stencil is 1 (a kept
  // element), only in front of what is there. style 'tint' | 'outline'; color [r, g, b] 0..1;
  // width: the outline's half-width in px. The caller restores its own GL state.
  function composite(layer, { style = 'tint', color = [0.5, 0.5, 0.5], width = 1 } = {}) {
    const t = targets.get(layer); if (!t) return;
    gl.useProgram(comp);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, t.depth); gl.uniform1i(u.depth, 2);
    gl.uniform1i(u.style, style === 'outline' ? 1 : 0);
    gl.uniform3f(u.color, color[0], color[1], color[2]);
    gl.uniform1i(u.width, Math.max(1, Math.min(4, Math.round(width))));
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(false);
    gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.NOTEQUAL, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.STENCIL_TEST); gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);   // a later pass may render into it
  }
  return { begin, composite, drop, has: (layer) => targets.has(layer), clear() { for (const id of [...targets.keys()]) drop(id); } };
}
