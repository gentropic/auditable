// A layer's view of the section — ONE definition for the draw (gl.js) and the
// pick (gl-pick.js). They were two hand-kept copies; a pick that disagrees with
// the picture is the bug a geologist meets on exactly the views they work in.
//
// sec: { n, d, half, d0?, clip?, traceHalf? } — d0 is the plane, d/half the slab
// mode (a layer's `sectioned`):
//   true            follow the section
//   false           don't cut
//   'front'/'behind' keep that side only (a half-space is a slab with the far
//                   face pushed past the data — the global clip's own trick)
//   { half }        follow with this layer's OWN slab: ± half around the plane,
//                   whatever the section's slab or half-space
//   { whole: true } don't cut — the host hides what misses the slab itself
//                   (micro keeps the drillholes that cross it, whole)
// offset: a moved layer (setLayerOffset) is cut where it is DRAWN — in its own
// coordinates the plane sits at d − n·o.

export function offsetSection(sec, o) {
  if (!sec || !o) return sec;
  const k = sec.n[0] * o[0] + sec.n[1] * o[1] + sec.n[2] * o[2];
  return sec.d0 !== undefined ? { ...sec, d: sec.d - k, d0: sec.d0 - k } : { ...sec, d: sec.d - k };
}

export function layerSection(sec, mode = true, offset = null) {
  sec = offsetSection(sec, offset);
  const m = mode;
  if (m && typeof m === 'object') {
    if (!sec || m.whole) return null;
    if (m.half > 0) return { ...sec, d: sec.d0 !== undefined ? sec.d0 : sec.d, half: m.half, clip: 'slab', traceHalf: undefined };
    return sec;
  }
  if (!sec || m === false) return null;
  if ((m === 'front' || m === 'behind') && sec.d0 !== undefined) {
    const H = Math.max(1e5, 8 * (sec.half || 1));
    return { ...sec, d: m === 'front' ? sec.d0 + H : sec.d0 - H, half: H, clip: m, traceHalf: sec.traceHalf || (sec.half < 9e4 ? sec.half : 1) };
  }
  return sec;
}

// meshes render their section as a TRACE flattened onto the wall — for a
// half-space the slab half is ~1e5 (it swallows the scene), so the trace band
// narrows to the TRUE plane ± traceHalf; slab sections already carry the width
export function meshSection(sec, mode = true, offset = null) {
  const s2 = layerSection(sec, mode, offset);
  if (!s2 || !(s2.clip === 'front' || s2.clip === 'behind') || s2.d0 === undefined) return s2;
  return { ...s2, d: s2.d0, half: Math.max(0.01, s2.traceHalf || 1) };
}
