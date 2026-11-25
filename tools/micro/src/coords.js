// micro COORDS — the ONE place micro reads or sets the scene's frame.
//
// Two spaces, and every coordinate is in exactly one of them:
//   WORLD — what a file, the user, a host page or a report says: UTM metres, elevations. Source
//           documents, the host API, every number shown to a person.
//   LOCAL — what the renderer draws: WORLD minus the scene frame's ORIGIN. The first layer plants
//           the frame (near its data, so float32 on the GPU keeps its precision) and every layer
//           after is drawn in it. Camera state, pixelRay, bboxLocal, docBbox, the section slider,
//           condenser's chunks are LOCAL.
// A frame is a pure translation (@gcu/frame): directions, normals, dips and azimuths are the same
// in both spaces; positions move by the origin; a plane n·p = d moves its d by n·origin.
//
// A THIRD notion is not a space but a shift: a layer moved for display (an exploded group, a view
// beside its model) is DRAWN at its true position + its offset. `drawn` and `true` positions are
// both LOCAL (or both WORLD) — the offset is a translation inside one space.
//
// Names say the space: `…World` / `…Local` on values that cross modules, and these conversions
// at the boundary. tools/micro/dev/frame-lint.mjs fails on `frame.origin` arithmetic or `S.frame =`
// anywhere else, so a new hand-written conversion can't slip in (every coordinate bug of 2026-11-25
// was one of those, done slightly wrong or missing).
import { S } from './state.js';
import {
  makeFrame, toLocal, toWorld, axisToLocal, axisToWorld, rangeToLocal, rangeToWorld,
  boxToLocal, boxToWorld, planBoxToLocal, planBoxToWorld, planeToLocal, planeToWorld, rayToLocal, rayToWorld,
} from '../../../ext/frame/index.js';
import { documentFrame } from '../../../ext/condenser/src/main.js';

const IDENTITY = makeFrame({ origin: [0, 0, 0] });
const F = () => S.frame || IDENTITY;

// ── the scene frame's life ──
export const hasSceneFrame = () => !!S.frame;
// a COPY of the origin (read it, don't do arithmetic with it — use the conversions below)
export const sceneOrigin = () => F().origin.slice();
// the first dataset plants the frame from its header's WORLD bbox; later ones are drawn in it
export function plantSceneFrame(header) { if (!S.frame) S.frame = documentFrame(header, { crs: null }); return S.frame; }
// a new scene (close all) / a lone layer moved far, re-planted on its new place
export function clearSceneFrame() { S.frame = null; }
// the project's CRS is NAMED on the frame (identity only — a frame never reprojects)
export function nameSceneCrs(crsName) { if (S.frame) S.frame = { ...S.frame, crs: crsName || null }; }

// ── points ──
export const worldToLocal = (p) => toLocal(p, F());
export const localToWorld = (p) => toWorld(p, F());
// into an existing array (hot paths): out = p ∓ origin
export function worldToLocalInto(p, out) { const o = F().origin; out[0] = p[0] - o[0]; out[1] = p[1] - o[1]; if (p.length > 2) out[2] = p[2] - o[2]; return out; }
export function localToWorldInto(p, out) { const o = F().origin; out[0] = p[0] + o[0]; out[1] = p[1] + o[1]; if (p.length > 2) out[2] = p[2] + o[2]; return out; }

// ── one axis (0 x · 1 y · 2 z), a range on it ──
export const axisWorldToLocal = (v, axis) => axisToLocal(v, axis, F());
export const axisLocalToWorld = (v, axis) => axisToWorld(v, axis, F());
export const rangeWorldToLocal = (r, axis) => rangeToLocal(r, axis, F());
export const rangeLocalToWorld = (r, axis) => rangeToWorld(r, axis, F());

// ── boxes ──
export const boxWorldToLocal = (b) => boxToLocal(b, F());
export const boxLocalToWorld = (b) => boxToWorld(b, F());
export const planBoxWorldToLocal = (b) => planBoxToLocal(b, F());
export const planBoxLocalToWorld = (b) => planBoxToWorld(b, F());

// ── planes n·p = d ──
export const planeWorldToLocal = (n, d) => planeToLocal(n, d, F());
export const planeLocalToWorld = (n, d) => planeToWorld(n, d, F());

// ── rays (a pixel's ray is LOCAL: pick.js pixelRay) ──
export const rayLocalToWorld = (ray) => rayToWorld(ray, F());
export const rayWorldToLocal = (ray) => rayToLocal(ray, F());

// ── display offsets: drawn = true + the layer's offset (same space either side) ──
export const layerOffsetOf = (id) => (S.renderer && S.renderer.layerOffset ? S.renderer.layerOffset(id) : [0, 0, 0]);
export function trueToDrawn(p, id) { const d = layerOffsetOf(id); return [p[0] + d[0], p[1] + d[1], p[2] + d[2]]; }
export function drawnToTrue(p, id) { const d = layerOffsetOf(id); return [p[0] - d[0], p[1] - d[1], p[2] - d[2]]; }
