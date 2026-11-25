// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/core.js
// @gcu/condenser — Streaming no-preprocess renderer for massive spatial elements (point clouds, block models): stream-parse → quantize → chunk → prefix-LOD → progressive accumulation → EDL. The engine under micro.

// ── ../frame/src/frame.js ──

// @gcu/frame — the coordinate-frame contract for the whole GCU geometry stack.
//
// Geological work lives at projected-coordinate magnitudes (UTM easting ~5e5,
// northing ~7.7e6, RL ~1e3). Two failures follow and share one cause — doing math
// and rendering directly in those large numbers:
//   • the float32 wall — at northing 7.7e6 a 32-bit float resolves to ~1 m, so any
//     GPU/Float32Array path jitters and z-fights;
//   • catastrophic cancellation — derived quantities (lengths, cross products,
//     intersection params) lose relative precision, and a fixed ε like 1e-9 is
//     meaningless against operands of magnitude 1e6.
// The fix is to work in a small-magnitude LOCAL frame and keep the offset to WORLD
// as explicit, inspectable metadata. This module is that contract — a tiny value
// type plus pure functions, zero-dependency, that every coordinate-bearing package
// can speak.
//
// A Frame has two faculties with different reach:
//   1. numerical framing — the world↔local offset (`origin`), for the precision path
//      (dee/voxmesh/geometry/regula/dxf/moncad compute in it; it gates every F32 downcast);
//   2. coordinate identity — the `crs` descriptor + `units`, universal provenance so
//      "what do these world numbers mean" is never silent.
//
// HARD BOUNDARY: frame NAMES a CRS, it never CHANGES one. Reprojection (datum shifts,
// projection changes) is a geodetic operation that lives elsewhere (spinifex/proj4
// today, a future @gcu/proj if it ever becomes a stack primitive). Crossing CRS here
// throws — see `delta`. A working offset is a translation for numerical convenience,
// not a reprojection.
//
// Points and origins are ARRAYS — [x, y] or [x, y, z] — matching the rest of the tree
// (dee.origin, grid.origin, flat Float64/Float32 vertex buffers), not the {x,y,z}
// objects the prose spec sketches. The frame is pure translation: rotation/scale are
// deliberately out of scope (a block model's own dip/rake orientation is intrinsic
// model geometry, a separate concern from the local frame — never conflated).

// A Frame value. `origin` is the WORLD coordinate of the local origin, so
// `local = world − origin`. `crs` is an optional projection descriptor (e.g. an EPSG
// code) — null means "unstated", which opts out of cross-frame CRS checking. `units`
// defaults to metres.
function makeFrame({ origin, crs = null, units = 'm' } = {}) {
  const o = origin ? Array.from(origin, Number) : [0, 0, 0];
  while (o.length < 3) o.push(0);
  return { origin: o.slice(0, 3), crs, units };
}

// The identity frame: origin at world zero. World == local. Useful as a default and
// as the "already in world coordinates" marker.
const WORLD = makeFrame({ origin: [0, 0, 0] });

// Normalise a CRS code for IDENTITY comparison: uppercase + strip a leading `EPSG:`, so
// `'EPSG:31983'`, `'epsg:31983'`, and `'31983'` all compare equal. It lives HERE, not in a
// geo/reprojection layer: frame is zero-dep and sits *under* any such layer, so importing a
// helper from geo would invert the dependency. A reprojection layer's richer code resolution
// is a superset built on this. Comparison only — the stored `crs` keeps its original spelling.
function canonCrs(code) {
  return code == null ? null : String(code).trim().toUpperCase().replace(/^EPSG:/, '');
}

// Two frames describe the same projection iff their (canonicalised) CRS agree (a null CRS on
// either side is a wildcard — you can't assert a mismatch you never declared) and their units
// match. This is the gate that keeps a frame shift from masquerading as a reprojection.
function sameProjection(a, b) {
  const ca = canonCrs(a.crs), cb = canonCrs(b.crs);
  if (ca != null && cb != null && ca !== cb) return false;
  return (a.units ?? 'm') === (b.units ?? 'm');
}

// Full structural equality: same origin, (canonicalised) CRS, and units.
function frameEq(a, b) {
  return canonCrs(a.crs) === canonCrs(b.crs) && (a.units ?? 'm') === (b.units ?? 'm') &&
    a.origin[0] === b.origin[0] && a.origin[1] === b.origin[1] && a.origin[2] === b.origin[2];
}

// ── Point transforms (single [x,y] or [x,y,z]) ──────────────────────────────────

// World → local: subtract the origin component-wise. Round-trips losslessly with
// `toWorld` at f64 (invariant 3) — exact when the origin is chosen near the data, the
// intended use.
function toLocal(worldPt, frame) {
  const o = frame.origin, r = new Array(worldPt.length);
  for (let i = 0; i < worldPt.length; i++) r[i] = worldPt[i] - (o[i] || 0);
  return r;
}

// Local → world: add the origin back. The inverse of `toLocal`.
function toWorld$frame(localPt, frame) {
  const o = frame.origin, r = new Array(localPt.length);
  for (let i = 0; i < localPt.length; i++) r[i] = localPt[i] + (o[i] || 0);
  return r;
}

// ── Bulk buffer transforms (flat x,y,z,x,y,z,… arrays) ──────────────────────────
// These consolidate the hand-rolled F64-recentre loops currently duplicated in the
// dee importers (lfm/msh adapters): subtract the origin at full f64 precision and hand
// the small local magnitudes to the F32/GPU downcast. The one hard rule of §5 —
// anything bound for a Float32Array passes through the local frame FIRST — is this
// call. Returns a NEW Float64Array; input is never mutated.

function toLocalCoords(coords, frame, { stride = 3 } = {}) {
  const o = frame.origin, out = new Float64Array(coords.length);
  for (let i = 0; i < coords.length; i += stride)
    for (let j = 0; j < stride; j++) out[i + j] = coords[i + j] - (o[j] || 0);
  return out;
}

function toWorldCoords(coords, frame, { stride = 3 } = {}) {
  const o = frame.origin, out = new Float64Array(coords.length);
  for (let i = 0; i < coords.length; i += stride)
    for (let j = 0; j < stride; j++) out[i + j] = coords[i + j] + (o[j] || 0);
  return out;
}

// ── Axis values, boxes, planes, rays ────────────────────────────────────────────
// The other shapes a coordinate takes once it leaves a point. A frame is a pure
// translation, so each is the origin subtracted (or added) where it belongs — and the
// PLANE is the one that is not obvious: n·p = d becomes n·p' = d − n·origin, whatever
// the normal. Directions (a ray's, a normal) never change. Every function is pure and
// returns a new value; `null` / non-finite entries pass through untouched (an unset clip
// bound stays unset).

// one coordinate along axis 0 / 1 / 2 (x / y / z): an elevation, an easting, a section's
// position along an axis
function axisToLocal(v, axis, frame) { return v == null || !Number.isFinite(+v) ? v : +v - (frame.origin[axis] || 0); }
function axisToWorld(v, axis, frame) { return v == null || !Number.isFinite(+v) ? v : +v + (frame.origin[axis] || 0); }

// a [lo, hi] range along one axis (a colour clip on elevation, a z-range); either end may be null
const rangeToLocal = (r, axis, frame) => [axisToLocal(r[0], axis, frame), axisToLocal(r[1], axis, frame)];
const rangeToWorld = (r, axis, frame) => [axisToWorld(r[0], axis, frame), axisToWorld(r[1], axis, frame)];

// a 3D box as a flat [minX, minY, minZ, maxX, maxY, maxZ] (what renderers and bboxes use)
function boxToLocal(b, frame) { const o = frame.origin; return [b[0] - (o[0] || 0), b[1] - (o[1] || 0), b[2] - (o[2] || 0), b[3] - (o[0] || 0), b[4] - (o[1] || 0), b[5] - (o[2] || 0)]; }
function boxToWorld(b, frame) { const o = frame.origin; return [b[0] + (o[0] || 0), b[1] + (o[1] || 0), b[2] + (o[2] || 0), b[3] + (o[0] || 0), b[4] + (o[1] || 0), b[5] + (o[2] || 0)]; }

// a plan box [minX, minY, maxX, maxY] (a grid's or a polygon's extent)
function planBoxToLocal(b, frame) { const o = frame.origin; return [b[0] - (o[0] || 0), b[1] - (o[1] || 0), b[2] - (o[0] || 0), b[3] - (o[1] || 0)]; }
function planBoxToWorld(b, frame) { const o = frame.origin; return [b[0] + (o[0] || 0), b[1] + (o[1] || 0), b[2] + (o[0] || 0), b[3] + (o[1] || 0)]; }

// a plane n·p = d (n need not be unit): the normal is unchanged, the offset moves by n·origin
const dotO = (n, o) => n[0] * (o[0] || 0) + n[1] * (o[1] || 0) + (n.length > 2 ? n[2] * (o[2] || 0) : 0);
function planeToLocal(n, d, frame) { return d - dotO(n, frame.origin); }
function planeToWorld(n, d, frame) { return d + dotO(n, frame.origin); }

// a ray { o, d }: its origin moves, its direction does not
function rayToLocal(ray, frame) { return { o: toLocal(ray.o, frame), d: ray.d.slice() }; }
function rayToWorld(ray, frame) { return { o: toWorld$frame(ray.o, frame), d: ray.d.slice() }; }

// ── Choosing an origin ──────────────────────────────────────────────────────────

// Pick a sticky origin from world-coordinate bounds. Default strategy 'centroid'
// (bbox centre); 'floor' keeps locals strictly positive (handy across tiled exports).
// The result is rounded to `round` so the anchor reads as a "nice" number in logs and
// diffs rather than an arbitrary fractional point. bounds = { min:[…], max:[…] }.
// The origin is chosen ONCE per document/session and is sticky — recomputing it
// per-operation drifts the frame and invalidates cached geometry (§4).
function originFromBounds(bounds, { round = 1, strategy = 'centroid' } = {}) {
  const { min, max } = bounds, n = Math.min(min.length, max.length), o = [];
  for (let i = 0; i < n; i++) {
    const c = strategy === 'floor' ? min[i] : (min[i] + max[i]) / 2;
    o.push(round ? Math.round(c / round) * round : c);
  }
  while (o.length < 3) o.push(0);
  return o.slice(0, 3);
}

// Convenience: a Frame straight from bounds (origin via `originFromBounds`, carrying
// the given CRS/units).
function frameFromBounds(bounds, opts = {}) {
  return makeFrame({
    origin: originFromBounds(bounds, opts),
    crs: opts.crs ?? null,
    units: opts.units ?? 'm',
  });
}

// ── Frame-relative tolerance ────────────────────────────────────────────────────

// A tolerance scaled to the working extent, so coincidence / parallel / on-curve tests
// stay meaningful at any magnitude — a fixed absolute 1e-9 is meaningless against UTM
// operands, the same failure class as the original silent-shift bug. `extent` is the
// working span (e.g. the local bbox diagonal); `rel` is the relative floor. Feeds the
// @gcu/regula tolerance model. Note exact sign/orientation tests stay EXACT (@gcu/geometry
// predicates) — this ε is only for constructed quantities.
function extentTolerance(frame, extent, { rel = 1e-9 } = {}) {
  const e = Math.abs(extent) || 1;
  return { eps: rel * e, rel, extent: e, units: frame.units };
}

// ── Frame ↔ frame ───────────────────────────────────────────────────────────────

// The translation to add to a point expressed local-in `from` to re-express it
// local-in `to`:  localTo = localFrom + (fromOrigin − toOrigin). Throws if the frames
// describe different projections — moving between those is a reprojection, which frame
// does not perform (the hard boundary).
function delta(from, to) {
  if (!sameProjection(from, to)) {
    throw new Error(
      `frame.delta: frames differ in CRS/units (${from.crs}/${from.units} → ${to.crs}/${to.units}); ` +
      'that is a reprojection, which @gcu/frame does not perform',
    );
  }
  return [
    from.origin[0] - to.origin[0],
    from.origin[1] - to.origin[1],
    from.origin[2] - to.origin[2],
  ];
}

// Declare an artifact's frame WITHOUT moving its coordinates (invariant 2: a coordinate
// expressed in a local frame always carries an inspectable origin). Shallow, pure —
// returns a copy with `.frame` stamped. Re-EXPRESSING coordinates into a different
// frame is `rebaseCoords`, a separate and logged transform.
function withFrame(artifact, frame) {
  return { ...artifact, frame };
}

// Re-express a flat coordinate buffer from one frame into another. Returns BOTH the new
// Float64Array and a provenance record — rebasing is an explicit, accountable transform
// (invariants 4/5), so you cannot get the moved coordinates without the record of what
// moved them (the same "numbers plus an account of what I did to them" discipline as
// the DXF contract). Throws via `delta` on a CRS/units mismatch. Pure; input untouched.
function rebaseCoords(coords, from, to, { stride = 3 } = {}) {
  const d = delta(from, to);
  const out = new Float64Array(coords.length);
  for (let i = 0; i < coords.length; i += stride)
    for (let j = 0; j < stride; j++) out[i + j] = coords[i + j] + (d[j] || 0);
  return { coords: out, record: rebaseRecord(from, to, d) };
}

// A provenance entry for a rebase — what the caller pushes onto its frame log.
function rebaseRecord(from, to, d) {
  return {
    op: 'rebase',
    from: { origin: [...from.origin], crs: from.crs, units: from.units },
    to: { origin: [...to.origin], crs: to.crs, units: to.units },
    delta: d,
  };
}

// ── src/core/morton.js ──

// @gcu/condenser — Morton (Z-order) keys + a radix sort over indices.
// Batch-wise spatial chunking (micro-spec §2.1.3): quantize each point to a
// 10-bit lattice per axis against the batch bbox, interleave to a 30-bit key,
// radix-sort an index array by key (three 10-bit passes, ping-pong — sorting
// indices, not elements, avoids the 2× transient), then slice the sorted order
// into chunks. Points that are near in space land in the same chunk → tight
// chunk AABBs → frustum culling and front-to-back order fall out.

// Spread the low 10 bits of v so there are two zero bits between each.
function part1by2(v) {
  v &= 0x3ff;
  v = (v | (v << 16)) & 0x30000ff;
  v = (v | (v << 8)) & 0x300f00f;
  v = (v | (v << 4)) & 0x30c30c3;
  v = (v | (v << 2)) & 0x9249249;
  return v;
}

// 30-bit Morton key from 10-bit lattice coordinates.
function mortonKey(ix, iy, iz) {
  return (part1by2(iz) << 2) | (part1by2(iy) << 1) | part1by2(ix);
}

// Keys for a batch: quantize x/y/z (f64, any space — only intra-batch
// consistency matters) to 10 bits against the batch extent.
function mortonKeys(x, y, z, n) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < minX) minX = x[i]; if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i]; if (y[i] > maxY) maxY = y[i];
    if (z[i] < minZ) minZ = z[i]; if (z[i] > maxZ) maxZ = z[i];
  }
  const sx = maxX > minX ? 1023 / (maxX - minX) : 0;
  const sy = maxY > minY ? 1023 / (maxY - minY) : 0;
  const sz = maxZ > minZ ? 1023 / (maxZ - minZ) : 0;
  const keys = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    keys[i] = mortonKey(((x[i] - minX) * sx) | 0, ((y[i] - minY) * sy) | 0, ((z[i] - minZ) * sz) | 0);
  }
  return keys;
}

// Radix sort 0..n-1 by keys[] — three 10-bit passes, counting sort each,
// ping-pong index buffers. Stable; returns the sorted index array.
function radixSortIndices(keys, n) {
  let src = new Uint32Array(n), dst = new Uint32Array(n);
  for (let i = 0; i < n; i++) src[i] = i;
  const counts = new Uint32Array(1024);
  for (let pass = 0; pass < 3; pass++) {
    const shift = pass * 10;
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[(keys[src[i]] >>> shift) & 0x3ff]++;
    let sum = 0;
    for (let b = 0; b < 1024; b++) { const c = counts[b]; counts[b] = sum; sum += c; }
    for (let i = 0; i < n; i++) dst[counts[(keys[src[i]] >>> shift) & 0x3ff]++] = src[i];
    const t = src; src = dst; dst = t;
  }
  return src;
}

// ── src/core/chunks.js ──

// @gcu/condenser — the chunk store: RawChunks (world f64, from a provider) →
// render-ready Chunks (frame-local uint16 positions + attributes + record index).
//
// Frame-local first (micro-spec Addendum A.1): one @gcu/frame per document, chosen
// from the header bbox; everything downstream (chunk bboxes, camera, clip uniforms)
// lives at small local magnitudes so the f32/GPU path never sees a 7.7e6 northing.
// The frame is pure translation with CRS identity — publish world coordinates by
// adding the origin back at the boundary.
//
// The invariant everything rests on (micro-spec §2.1.4): after building, elements
// inside a chunk are RANDOMLY PERMUTED, so any prefix of a chunk is a uniform
// random subsample of that chunk's region. Prefix-LOD, progressive accumulation,
// and budget-capped drawing all read prefixes and inherit their correctness from
// this shuffle. Seeded PRNG (mulberry32) → deterministic for tests.
//
// Chunking is BATCH-MORTON (§2.1.3): accumulate ~batchSize elements, Morton-radix-
// sort the batch, slice the sorted order into chunks → spatially tight chunk AABBs
// (frustum culling + front-to-back fall out) while peak CPU memory stays bounded
// by batchSize × constant — never proportional to the file (§3 heap bound).
//
// Chunk = {
//   count, bboxLocal: Float64Array(6) [minX,minY,minZ,maxX,maxY,maxZ],
//   pos: Uint16Array(3N)  — quantized against bboxLocal (denormalize in-shader),
//   intensity: Uint16Array, classification: Uint8Array, rgb: Uint8Array(3N)|null,
//   recIdx: Uint32Array   — row number in the source file: THE join key (§4).
// }


// mulberry32 — tiny seeded PRNG; good enough for a decorrelating shuffle.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates permutation of 0..n-1.
function shuffledIndices(n, rnd) {
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

// In-place Fisher–Yates over an existing index array (a gather list).
function shuffleInPlace(idx, rnd) {
  for (let i = idx.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

// Pick the document frame from a provider header (bbox in world coords). CRS is
// identity metadata only — condenser never reprojects.
function documentFrame(header, { crs = null } = {}) {
  const b = header.bbox;
  if (b && Number.isFinite(b.min[0]) && Number.isFinite(b.max[0]) && (b.max[0] || b.min[0])) {
    return frameFromBounds({ min: b.min, max: b.max }, { crs, round: 1 });
  }
  return makeFrame({ origin: [0, 0, 0], crs });            // no usable bbox → identity
}

/**
 * Build one render Chunk from columnar source arrays. `indices` is an optional
 * gather list (element ids into the columns — e.g. one Morton-ordered slice of a
 * batch); omitted → all elements. The gather list is SHUFFLED (in a copy) before
 * the single gather-quantize pass — gather and shuffle cost one pass together.
 */
function buildChunk({ x, y, z, intensity, classification, rgb, recIdx }, frame, rnd, indices = null) {
  const n = indices ? indices.length : x.length;
  const o = frame.origin;
  // pass 1 — frame-local bbox (f64 subtract BEFORE any narrowing — the one hard rule)
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = indices ? indices[k] : k;
    const px = x[i] - o[0], py = y[i] - o[1], pz = z[i] - o[2];
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
  }
  const sx = maxX > minX ? 65535 / (maxX - minX) : 0;
  const sy = maxY > minY ? 65535 / (maxY - minY) : 0;
  const sz = maxZ > minZ ? 65535 / (maxZ - minZ) : 0;
  // pass 2 — shuffle the gather order, then gather + quantize in one sweep
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const pos = new Uint16Array(3 * n);
  const outI = new Uint16Array(n), outC = new Uint8Array(n), outR = new Uint32Array(n);
  const outRgb = rgb ? new Uint8Array(3 * n) : null;
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    pos[k * 3] = ((x[i] - o[0] - minX) * sx + 0.5) | 0;
    pos[k * 3 + 1] = ((y[i] - o[1] - minY) * sy + 0.5) | 0;
    pos[k * 3 + 2] = ((z[i] - o[2] - minZ) * sz + 0.5) | 0;
    outI[k] = intensity[i];
    outC[k] = classification[i];
    outR[k] = recIdx[i];
    if (outRgb) { outRgb[k * 3] = rgb[i * 3]; outRgb[k * 3 + 1] = rgb[i * 3 + 1]; outRgb[k * 3 + 2] = rgb[i * 3 + 2]; }
  }
  return {
    count: n,
    bboxLocal: Float64Array.of(minX, minY, minZ, maxX, maxY, maxZ),
    pos, intensity: outI, classification: outC, rgb: outRgb, recIdx: outR,
  };
}

// Denormalize one quantized element back to frame-local f64 (tests + picking).
function chunkLocalPosition(chunk, k) {
  const b = chunk.bboxLocal;
  const d = (v, mn, mx) => (mx > mn ? mn + (v / 65535) * (mx - mn) : mn);
  return [
    d(chunk.pos[k * 3], b[0], b[3]),
    d(chunk.pos[k * 3 + 1], b[1], b[4]),
    d(chunk.pos[k * 3 + 2], b[2], b[5]),
  ];
}

/**
 * ChunkBuilder — feed RawChunks as they stream in; emits finished Chunks via
 * onChunk. Batch-Morton by default: elements accumulate to ~batchSize, the batch
 * is Morton-sorted and sliced into chunkSize chunks (each internally shuffled).
 * `morton: false` slices in arrival order instead (still shuffled). flush()
 * emits the remainder and returns the document summary.
 */
function createChunkBuilder({ frame, chunkSize = 1 << 20, batchSize = 0, morton = true, seed = 1, onChunk }) {
  const rnd = mulberry32(seed);
  const batchN = batchSize || chunkSize * 4;               // default: 4 chunks per spatial batch
  let pend = [];                                           // pending RawChunk column slices
  let pendCount = 0;
  const doc = { count: 0, bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity), hasRgb: false };

  const concat = (Type, parts, per) => {
    const out = new Type(pendCount * per);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const emitChunk = (chunk) => {
    doc.count += chunk.count;
    doc.hasRgb = doc.hasRgb || !!chunk.rgb;
    const b = doc.bboxLocal, cb = chunk.bboxLocal;
    for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
    onChunk(chunk);
  };
  const flushBatch = () => {
    if (!pendCount) return;
    const cols = {
      x: concat(Float64Array, pend.map((p) => p.x), 1),
      y: concat(Float64Array, pend.map((p) => p.y), 1),
      z: concat(Float64Array, pend.map((p) => p.z), 1),
      intensity: concat(Uint16Array, pend.map((p) => p.intensity), 1),
      classification: concat(Uint8Array, pend.map((p) => p.classification), 1),
      rgb: pend.every((p) => p.rgb) ? concat(Uint8Array, pend.map((p) => p.rgb), 3) : null,
      recIdx: concat(Uint32Array, pend.map((p) => p.recIdx), 1),
    };
    const n = pendCount;
    pend = []; pendCount = 0;
    const order = morton ? radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n) : null;
    for (let start = 0; start < n; start += chunkSize) {
      const end = Math.min(start + chunkSize, n);
      const slice = order ? order.subarray(start, end)
        : Uint32Array.from({ length: end - start }, (_, i) => start + i);
      emitChunk(buildChunk(cols, frame, rnd, slice));
    }
  };

  return {
    push(raw) {
      // record indices: the provider may supply raw.recIdx directly (RAW record
      // numbers, gaps allowed — .dm skips bad rows but keeps true row numbers so
      // O(1) record fetch works); default = recStart + i (gapless providers).
      let recIdx = raw.recIdx;
      if (!recIdx) {
        recIdx = new Uint32Array(raw.count);
        for (let i = 0; i < raw.count; i++) recIdx[i] = raw.recStart + i;
      }
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const slice = (a, per = 1) => (a ? a.subarray(taken * per, (taken + n) * per) : null);
        pend.push({ x: slice(raw.x), y: slice(raw.y), z: slice(raw.z), intensity: slice(raw.intensity), classification: slice(raw.classification), rgb: slice(raw.rgb, 3), recIdx: recIdx.subarray(taken, taken + n) });
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}

// ── src/core/chan.js ──

// @gcu/condenser — the per-element VALUE code in a chunk (u16, normalized on the GPU).
// Code 0 is BLANK (a missing value); 1..65535 span the chunk's [min, max]. The reserved code
// is what lets a shader tell a missing value from the lowest one — before it, a blank FE drew
// in the bottom grade class, indistinguishable from real low grade. The builders write it
// (blocks.js, sticks.js); every reader dequantizes with chanDequant's two numbers as
// x + aChan·y — code 1 lands on min and 65535 on max, so the shader formula is unchanged —
// and calls a value blank when aChan < CHAN_BLANK_T. With no-data off, a blank decodes just
// under min and clamps to the lowest colour: exactly the old picture.
const CHAN_BLANK_T = 0.5 / 65535;
function chanScale(lo, hi) { return hi > lo ? 65534 / (hi - lo) : 0; }
function chanCode(v, lo, scale) { return Number.isFinite(v) ? 1 + (((v - lo) * scale + 0.5) | 0) : 0; }
function chanDequant(range) {
  const lo = range[0], span = range[1] - range[0];
  return span > 0 ? [lo - span / 65534, (span * 65535) / 65534] : [lo, 0];
}

// ── src/core/blocks.js ──

// @gcu/condenser — block-model chunks: IJK-exact representation (micro-spec §2.5).
//
// For a REGULAR uniform grid, a block's centroid is fully determined by its integer
// IJK: center = grid.originLocal + ijk · size, where originLocal is the CENTROID of
// block (0,0,0) — the centroid convention throughout. Chunks store raw uint16 IJK
// (not bbox-normalized lattice positions), so reconstruction is EXACT — and IJK is
// itself useful for the grid-view join. Half-dims are a chunk-level uniform (all
// blocks one size) for a REGULAR grid — 0 bytes per block. SUB-BLOCKED models use
// the same IJK scheme against a FINE lattice (grid/support.js: pitch = half the size
// step) plus each block's size in fine steps, chunk.dimQ = u8 × 3 per block (the
// block-support contract); centroids stay exact, half = dimQ · pitch / 2.
//
// Attributes per block: one SCALAR channel (grade — f32 in, quantized u16 against
// the chunk's min/max, range carried per chunk) + one CATEGORY channel (u8 codes
// from the provider's dictionary, ≤255 distinct) + uint32 record index (the join).
// The intra-chunk shuffle invariant (§2.1.4) applies unchanged.
//
// BlockChunk = {
//   kind: 'blocks', count,
//   grid: { originLocal: [x,y,z], size: [dx,dy,dz] },   — shared, frame-local
//   ijk: Uint16Array(3N), chan: Uint16Array(N), chanRange: [min,max],
//   cat: Uint8Array(N), recIdx: Uint32Array(N),
//   bboxLocal: Float64Array(6)                          — outer faces, for culling
//   dimQ?: Uint8Array(3N), dimQMax?: [3]                — sub-blocked: sizes in fine steps
// }


// Grid from three axes + a frame → the block-chunk grid descriptor. origin here
// is the centroid of block (0,0,0), frame-local.
//
// ROTATED lattices (grid/basis.js): `rot` is the rotation R (column-major,
// columns = the unit U/V/W directions) and `anchor` the world point the lattice
// coordinates are measured from (block 0's centroid, canonically). The axes are
// then LATTICE coordinates q = Rᵀ·(p − anchor), where the lattice is
// axis-aligned; block (i,j,k)'s world centroid is anchor + R·(origin_q + ijk·pitch).
// An axis-aligned grid is rot = null, so every existing caller is unchanged.
function makeBlockGrid(axes, frame, rot = null, anchor = null) {
  const o = frame.origin;
  const q0 = [axes[0].origin, axes[1].origin, axes[2].origin];
  const R = rot && !isIdentity3(rot) ? Array.from(rot) : null;
  let originLocal;
  if (R) {
    const A = anchor || [0, 0, 0];
    const d = [R[0] * q0[0] + R[3] * q0[1] + R[6] * q0[2], R[1] * q0[0] + R[4] * q0[1] + R[7] * q0[2], R[2] * q0[0] + R[5] * q0[1] + R[8] * q0[2]];
    originLocal = [(A[0] - o[0]) + d[0], (A[1] - o[1]) + d[1], (A[2] - o[2]) + d[2]];   // anchor − frame first: small numbers meet small numbers
  } else originLocal = [q0[0] - o[0], q0[1] - o[1], q0[2] - o[2]];
  const g = {
    originLocal,
    size: [axes[0].pitch || 1, axes[1].pitch || 1, axes[2].pitch || 1],
    count: [axes[0].count, axes[1].count, axes[2].count],
  };
  if (R) { g.rot = Float32Array.from(R); g.rotD = R; }       // f32 for the GPU, f64 for CPU math
  return g;
}
const isIdentity3 = (r) => Math.abs(r[0] - 1) < 1e-12 && Math.abs(r[4] - 1) < 1e-12 && Math.abs(r[8] - 1) < 1e-12
  && Math.abs(r[1]) < 1e-12 && Math.abs(r[2]) < 1e-12 && Math.abs(r[3]) < 1e-12 && Math.abs(r[5]) < 1e-12 && Math.abs(r[6]) < 1e-12 && Math.abs(r[7]) < 1e-12;

/**
 * Build one BlockChunk from columnar world-space block centroids + attributes.
 * `indices` = optional gather list (a Morton slice); shuffled like point chunks.
 * IJK is computed against the grid; anything off-lattice snaps to the nearest
 * cell (the provider validated regularity during discovery).
 */
function buildBlockChunk({ x, y, z, chan, cat, recIdx, dimQ }, grid, frame, rnd, indices = null) {
  const n = indices ? indices.length : x.length;
  const o = frame.origin;
  const [gx, gy, gz] = grid.originLocal, [sx, sy, sz] = grid.size;
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const ijk = new Uint16Array(3 * n);
  const outChan = new Uint16Array(n), outCat = new Uint8Array(n), outR = new Uint32Array(n);
  const sub = !!dimQ;                                       // sub-blocked → per-block size in fine steps
  const outDimQ = sub ? new Uint8Array(3 * n) : null;
  let qmx = 0, qmy = 0, qmz = 0;
  // chan range over this chunk (quantize against it — per-chunk min/max, §2.1.2)
  let cMin = Infinity, cMax = -Infinity;
  for (let k = 0; k < n; k++) { const v = chan[perm[k]]; if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; } }
  if (!Number.isFinite(cMin)) { cMin = 0; cMax = 0; }
  const cScale = chanScale(cMin, cMax);                   // code 0 = blank, 1..65535 = min..max (chan.js)
  let minI = 65535, minJ = 65535, minK = 65535, maxI = 0, maxJ = 0, maxK = 0;
  // sub-blocked: the box faces in LATTICE units (doubled, so centre ± size stays integer) for the cull bbox
  let f0i = Infinity, f0j = Infinity, f0k = Infinity, f1i = -Infinity, f1j = -Infinity, f1k = -Infinity;
  const R = grid.rotD || null;                              // rotated lattice: IJK in the lattice frame
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    let bi, bj, bk;
    if (R) {
      const dx = x[i] - o[0] - gx, dy = y[i] - o[1] - gy, dz = z[i] - o[2] - gz;
      bi = Math.max(0, Math.round((R[0] * dx + R[1] * dy + R[2] * dz) / sx));
      bj = Math.max(0, Math.round((R[3] * dx + R[4] * dy + R[5] * dz) / sy));
      bk = Math.max(0, Math.round((R[6] * dx + R[7] * dy + R[8] * dz) / sz));
    } else {
      bi = Math.max(0, Math.round((x[i] - o[0] - gx) / sx));
      bj = Math.max(0, Math.round((y[i] - o[1] - gy) / sy));
      bk = Math.max(0, Math.round((z[i] - o[2] - gz) / sz));
    }
    ijk[k * 3] = bi; ijk[k * 3 + 1] = bj; ijk[k * 3 + 2] = bk;
    if (bi < minI) minI = bi; if (bi > maxI) maxI = bi;
    if (bj < minJ) minJ = bj; if (bj > maxJ) maxJ = bj;
    if (bk < minK) minK = bk; if (bk > maxK) maxK = bk;
    const cv = chan[i];
    outChan[k] = chanCode(cv, cMin, cScale);
    outCat[k] = cat ? cat[i] : 0;
    outR[k] = recIdx[i];
    if (sub) {
      const qx = dimQ[i * 3], qy = dimQ[i * 3 + 1], qz = dimQ[i * 3 + 2];
      outDimQ[k * 3] = qx; outDimQ[k * 3 + 1] = qy; outDimQ[k * 3 + 2] = qz;
      if (qx > qmx) qmx = qx; if (qy > qmy) qmy = qy; if (qz > qmz) qmz = qz;
      const ci = 2 * bi, cj = 2 * bj, ck = 2 * bk;
      if (ci - qx < f0i) f0i = ci - qx; if (ci + qx > f1i) f1i = ci + qx;
      if (cj - qy < f0j) f0j = cj - qy; if (cj + qy > f1j) f1j = cj + qy;
      if (ck - qz < f0k) f0k = ck - qz; if (ck + qz > f1k) f1k = ck + qz;
    }
  }
  // culling bbox = outer faces of the extreme blocks (variable-size when sub-blocked),
  // as a box in lattice cells; rotated: the world AABB of its 8 corners through R.
  const lo = sub ? [f0i / 2, f0j / 2, f0k / 2] : [minI - 0.5, minJ - 0.5, minK - 0.5];
  const hi = sub ? [f1i / 2, f1j / 2, f1k / 2] : [maxI + 0.5, maxJ + 0.5, maxK + 0.5];
  let bboxLocal;
  if (R) {
    bboxLocal = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    for (const ci of [lo[0], hi[0]]) for (const cj of [lo[1], hi[1]]) for (const ck of [lo[2], hi[2]]) {
      const u = ci * sx, v = cj * sy, w = ck * sz;
      const p = [gx + R[0] * u + R[3] * v + R[6] * w, gy + R[1] * u + R[4] * v + R[7] * w, gz + R[2] * u + R[5] * v + R[8] * w];
      for (let a = 0; a < 3; a++) { if (p[a] < bboxLocal[a]) bboxLocal[a] = p[a]; if (p[a] > bboxLocal[a + 3]) bboxLocal[a + 3] = p[a]; }
    }
  } else {
    bboxLocal = Float64Array.of(gx + lo[0] * sx, gy + lo[1] * sy, gz + lo[2] * sz, gx + hi[0] * sx, gy + hi[1] * sy, gz + hi[2] * sz);
  }
  const chunk = { kind: 'blocks', count: n, grid, ijk, chan: outChan, chanRange: [cMin, cMax], cat: outCat, recIdx: outR, bboxLocal };
  if (sub) { chunk.dimQ = outDimQ; chunk.dimQMax = [qmx, qmy, qmz]; }
  return chunk;
}

// Exact centroid of element k, frame-local (tests + picking).
function blockLocalCenter(chunk, k) {
  const g = chunk.grid;
  const u = chunk.ijk[k * 3] * g.size[0], v = chunk.ijk[k * 3 + 1] * g.size[1], w = chunk.ijk[k * 3 + 2] * g.size[2];
  const R = g.rotD;
  if (R) return [g.originLocal[0] + R[0] * u + R[3] * v + R[6] * w, g.originLocal[1] + R[1] * u + R[4] * v + R[7] * w, g.originLocal[2] + R[2] * u + R[5] * v + R[8] * w];
  return [g.originLocal[0] + u, g.originLocal[1] + v, g.originLocal[2] + w];
}

// a batch's own random stream (seedPerBatch): batch k shuffles the same way
// whoever builds it and whatever was built before — what lets batches be built
// in parallel (micro's chunkworker) and still come out byte-identical
const batchSeed = (seed, k) => (Math.imul(k + 1, 0x9E3779B1) ^ seed) >>> 0;

// ONE Morton batch → its chunks: sort the batch by Morton key, slice it into
// chunkSize pieces, build (and shuffle) each. cols = { x, y, z, chan, cat, dimQ,
// recIdx } of n records. The builder's batch step, exported so a worker can run it.
function buildBlockBatch(cols, n, { grid, frame, chunkSize, rnd }) {
  const order = radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n);
  const out = [];
  for (let start = 0; start < n; start += chunkSize) out.push(buildBlockChunk(cols, grid, frame, rnd, order.subarray(start, Math.min(start + chunkSize, n))));
  return out;
}

/**
 * Legacy size CODES (u8) + a half-dim palette — the Jupyter widget's wire format —
 * → dimQ (u8 × 3, fine steps of the grid's pitch). The engine draws dimQ only.
 */
function dimQFromCodes(codes, palette, grid, n = codes.length) {
  const s = grid.size, lut = new Uint8Array(palette.length * 3);
  for (let c = 0; c < palette.length; c++) for (let a = 0; a < 3; a++) lut[c * 3 + a] = Math.max(1, Math.min(255, Math.round((2 * palette[c][a]) / s[a])));
  const out = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) { const c = codes[i] < palette.length ? codes[i] : 0; out[i * 3] = lut[c * 3]; out[i * 3 + 1] = lut[c * 3 + 1]; out[i * 3 + 2] = lut[c * 3 + 2]; }
  return out;
}

/**
 * BlockChunkBuilder — same shape as createChunkBuilder but for block RawChunks
 * ({ count, x, y, z, chan: Float32Array|Float64Array, cat: Uint8Array|null,
 * dimQ: Uint8Array(3·count)|null, recStart }). Batch-Morton, sliced, shuffled.
 * Tracks the document chan range (for the color ramp) alongside the local bbox.
 * A sub-blocked raw chunk carries dimQ; `dimPalette` accepts the legacy code +
 * palette form (raw.dim, the widget's wire) and converts it (dimQFromCodes).
 */
// The size of the Morton batch that starts at record `start`. batchN everywhere, unless
// the builder knows the stream's `total`: then its last 2–3 batches' worth is cut into
// `tailPieces` equal smaller batches. A batch is built whole, after its last record
// arrives, so the open's tail — the time from the stream's end to the last chunk — is
// one batch's build; at 2M records that was ~1.2 s on a worker, a piece is a fraction
// of it, and several pieces build at once on a parallel builder. Deterministic (it
// depends on total alone), and the same rule here and in micro's parallel builder.
function batchSizeAt(start, batchN, total = 0, tailPieces = 8) {
  if (!(total > 0) || !(tailPieces > 1)) return batchN;
  const tailStart = Math.max(0, Math.floor(total / batchN) - 2) * batchN;
  if (start < tailStart) return batchN;
  return Math.max(1, Math.ceil((total - tailStart) / tailPieces));
}
function createBlockChunkBuilder({ frame, grid, dimPalette = null, chunkSize = 1 << 20, batchSize = 0, seed = 1, seedPerBatch = false, total = 0, tailPieces = 8, onChunk }) {
  let rnd = mulberry32(seed), batchNo = 0, cutAt = 0;
  const batchN0 = batchSize || chunkSize * 4;
  let batchN = batchSizeAt(0, batchN0, total, tailPieces);
  let pend = [], pendCount = 0;
  const doc = {
    count: 0,
    bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity),
    chanRange: [Infinity, -Infinity],
  };
  const concat = (Type, parts, per = 1) => {
    const out = new Type(pendCount * per);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const flushBatch = () => {
    if (!pendCount) return;
    const cols = {
      x: concat(Float64Array, pend.map((p) => p.x)),
      y: concat(Float64Array, pend.map((p) => p.y)),
      z: concat(Float64Array, pend.map((p) => p.z)),
      chan: concat(Float64Array, pend.map((p) => p.chan)),
      cat: pend.every((p) => p.cat) ? concat(Uint8Array, pend.map((p) => p.cat)) : null,
      dimQ: pend.every((p) => p.dimQ) ? concat(Uint8Array, pend.map((p) => p.dimQ), 3) : null,
      recIdx: concat(Uint32Array, pend.map((p) => p.recIdx)),
    };
    const n = pendCount;
    pend = []; pendCount = 0;
    cutAt += n; batchN = batchSizeAt(cutAt, batchN0, total, tailPieces);
    if (seedPerBatch) rnd = mulberry32(batchSeed(seed, batchNo));
    batchNo++;
    for (const chunk of buildBlockBatch(cols, n, { grid, frame, chunkSize, rnd })) {
      doc.count += chunk.count;
      const b = doc.bboxLocal, cb = chunk.bboxLocal;
      for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
      if (chunk.chanRange[0] < doc.chanRange[0]) doc.chanRange[0] = chunk.chanRange[0];
      if (chunk.chanRange[1] > doc.chanRange[1]) doc.chanRange[1] = chunk.chanRange[1];
      onChunk(chunk);
    }
  };
  return {
    push(raw) {
      // record indices: the provider may supply raw.recIdx directly (RAW record
      // numbers, gaps allowed — .dm skips bad rows but keeps true row numbers so
      // O(1) record fetch works); default = recStart + i (gapless providers).
      let recIdx = raw.recIdx;
      if (!recIdx) {
        recIdx = new Uint32Array(raw.count);
        for (let i = 0; i < raw.count; i++) recIdx[i] = raw.recStart + i;
      }
      const dimQ = raw.dimQ || (raw.dim && dimPalette ? dimQFromCodes(raw.dim, dimPalette, grid, raw.count) : null);
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const s = (a) => (a ? a.subarray(taken, taken + n) : null);
        pend.push({ x: s(raw.x), y: s(raw.y), z: s(raw.z), chan: s(raw.chan), cat: s(raw.cat), dimQ: dimQ ? dimQ.subarray(taken * 3, (taken + n) * 3) : null, recIdx: recIdx.subarray(taken, taken + n) });
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}

// ── src/core/sticks.js ──

// @gcu/condenser — stick chunks: drillhole interval SEGMENTS (desurveyed
// endpoint pairs) as instanced capsule impostors (micro-layers spec §6).
// Same chunk discipline as blocks/points: batch-Morton on the midpoints,
// intra-chunk shuffle (any prefix = a uniform subsample), per-chunk channel
// quantization. Coordinates stay Float32 frame-local — stick counts are
// 10³–10⁶, so the uint16 squeeze isn't needed and endpoints stay exact
// to ~mm at frame-local magnitudes.


/**
 * Build one StickChunk from columnar world-space endpoints + attributes.
 * raw = { ax..az, bx..bz (endpoints), x,y,z (midpoints), chan, cat, recIdx }.
 * `indices` = optional gather list (a Morton slice); shuffled like the others.
 */
function buildStickChunk(raw, frame, rnd, indices = null) {
  const n = indices ? indices.length : raw.x.length;
  const o = frame.origin;
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const seg = new Float32Array(6 * n);                     // ax ay az bx by bz, frame-local
  const outChan = new Uint16Array(n), outCat = new Uint8Array(n), outR = new Uint32Array(n);
  let cMin = Infinity, cMax = -Infinity;
  for (let k = 0; k < n; k++) { const v = raw.chan[perm[k]]; if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; } }
  if (!Number.isFinite(cMin)) { cMin = 0; cMax = 0; }
  const cScale = chanScale(cMin, cMax);                   // code 0 = blank, 1..65535 = min..max (chan.js)
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    const A = [raw.ax[i] - o[0], raw.ay[i] - o[1], raw.az[i] - o[2]];
    const B = [raw.bx[i] - o[0], raw.by[i] - o[1], raw.bz[i] - o[2]];
    seg[k * 6] = A[0]; seg[k * 6 + 1] = A[1]; seg[k * 6 + 2] = A[2];
    seg[k * 6 + 3] = B[0]; seg[k * 6 + 4] = B[1]; seg[k * 6 + 5] = B[2];
    for (let a = 0; a < 3; a++) {
      if (A[a] < bb[a]) bb[a] = A[a]; if (A[a] > bb[a + 3]) bb[a + 3] = A[a];
      if (B[a] < bb[a]) bb[a] = B[a]; if (B[a] > bb[a + 3]) bb[a + 3] = B[a];
    }
    const cv = raw.chan[i];
    outChan[k] = chanCode(cv, cMin, cScale);
    outCat[k] = raw.cat ? raw.cat[i] : 0;
    outR[k] = raw.recIdx[i];
  }
  // NB: the culling bbox covers the SEGMENTS; the renderer pads it by the
  // current stick radius at cull time (the radius is a live per-layer knob).
  return { kind: 'sticks', count: n, seg, chan: outChan, chanRange: [cMin, cMax], cat: outCat, recIdx: outR, bboxLocal: Float64Array.from(bb) };
}

// Exact midpoint of element k, frame-local (tests + pick verification).
function stickLocalCenter(chunk, k) {
  const s = chunk.seg;
  return [(s[k * 6] + s[k * 6 + 3]) / 2, (s[k * 6 + 1] + s[k * 6 + 4]) / 2, (s[k * 6 + 2] + s[k * 6 + 5]) / 2];
}

/**
 * StickChunkBuilder — the blocks builder's shape over segment RawChunks
 * ({ count, ax..bz, x,y,z, chan, cat, recIdx }). Batch-Morton on midpoints,
 * sliced, shuffled.
 */
function createStickChunkBuilder({ frame, chunkSize = 1 << 17, batchSize = 0, seed = 1, onChunk }) {
  const rnd = mulberry32(seed);
  const batchN = batchSize || chunkSize * 4;
  let pend = [], pendCount = 0;
  const doc = {
    count: 0,
    bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity),
    chanRange: [Infinity, -Infinity],
  };
  const concat = (Type, parts) => {
    const out = new Type(parts.reduce((t, p) => t + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const flushBatch = () => {
    if (!pendCount) return;
    const cols = {
      ax: concat(Float64Array, pend.map((p) => p.ax)), ay: concat(Float64Array, pend.map((p) => p.ay)), az: concat(Float64Array, pend.map((p) => p.az)),
      bx: concat(Float64Array, pend.map((p) => p.bx)), by: concat(Float64Array, pend.map((p) => p.by)), bz: concat(Float64Array, pend.map((p) => p.bz)),
      x: concat(Float64Array, pend.map((p) => p.x)), y: concat(Float64Array, pend.map((p) => p.y)), z: concat(Float64Array, pend.map((p) => p.z)),
      chan: concat(Float64Array, pend.map((p) => p.chan)),
      cat: pend.every((p) => p.cat) ? concat(Uint8Array, pend.map((p) => p.cat)) : null,
      recIdx: concat(Uint32Array, pend.map((p) => p.recIdx)),
    };
    const n = pendCount;
    pend = []; pendCount = 0;
    const order = radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n);
    for (let start = 0; start < n; start += chunkSize) {
      const slice = order.subarray(start, Math.min(start + chunkSize, n));
      const chunk = buildStickChunk(cols, frame, rnd, slice);
      doc.count += chunk.count;
      const b = doc.bboxLocal, cb = chunk.bboxLocal;
      for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
      if (chunk.chanRange[0] < doc.chanRange[0]) doc.chanRange[0] = chunk.chanRange[0];
      if (chunk.chanRange[1] > doc.chanRange[1]) doc.chanRange[1] = chunk.chanRange[1];
      onChunk(chunk);
    }
  };
  return {
    push(raw) {
      let recIdx = raw.recIdx;
      if (!recIdx) {
        recIdx = new Uint32Array(raw.count);
        for (let i = 0; i < raw.count; i++) recIdx[i] = (raw.recStart || 0) + i;
      }
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const s = (a) => (a ? a.subarray(taken, taken + n) : null);
        pend.push({ ax: s(raw.ax), ay: s(raw.ay), az: s(raw.az), bx: s(raw.bx), by: s(raw.by), bz: s(raw.bz), x: s(raw.x), y: s(raw.y), z: s(raw.z), chan: s(raw.chan), cat: s(raw.cat), recIdx: recIdx.subarray(taken, taken + n) });
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}

// ── src/core/mesh-geom.js ──

// @gcu/condenser — mesh GEOMETRY builders (core: no I/O). World-f64 vertices
// → frame-local Float32 chunks for the static indexed pipeline (gl-mesh.js),
// plus the heightfield triangulator (a regular grid IS a single-valued
// surface). The file readers (.msh/.obj/.ply) live in io/mesh-io.js.
// ── world f64 → one frame-local GPU-ready chunk ──
// Float32 positions are safe at frame-local magnitudes (the whole point of
// @gcu/frame); indices stay u32. Context meshes are ONE chunk — they draw
// whole on clear frames, no prefix, no budget.
function buildMeshChunk({ vertices, triangles, frame }) {
  const o = frame ? frame.origin : [0, 0, 0];
  const n = (vertices.length / 3) | 0;
  const pos = new Float32Array(3 * n);
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = vertices[3 * i + k] - o[k];
      pos[3 * i + k] = v;
      if (v < bb[k]) bb[k] = v;
      if (v > bb[k + 3]) bb[k + 3] = v;
    }
  }
  return {
    kind: 'mesh',
    pos,
    idx: triangles instanceof Uint32Array ? triangles : Uint32Array.from(triangles),
    count: (triangles.length / 3) | 0,                     // elements = triangles
    vertexCount: n,
    bboxLocal: Float64Array.from(bb),
  };
}

// A regular grid IS a single-valued heightfield — triangulate its lattice into a
// mesh chunk with per-vertex smooth normals (grid-gradient central differences)
// and a per-vertex value (the caller maps it to a color via its own colormap).
// Quads touching a nodata corner are dropped → clean holes. Coords are frame-
// local. Strided to a display cap by the caller (bounded triangle count).
// flatZ (a world elevation) makes a FLAT horizontal sheet at that z instead of a
// heightfield — for a 2D data grid (grade/geochem) with no DEM; `values` stays the
// grid value so the caller still colors by it, and the normal is straight up.
function buildHeightfieldMesh(grid, { stride = 1, frame = null, flatZ = null } = {}) {
  const { nx, ny, data, x0, y0, dx, dy, nodata } = grid;
  const o = (frame && frame.origin) || [0, 0, 0];
  const flat = flatZ != null, flatLocal = flat ? flatZ - o[2] : 0;
  const isBad = (v) => Number.isNaN(v) || (nodata != null && (nodata >= 1.7e38 ? v >= 1.7014e38 : v === nodata));
  const cols = Math.floor((nx - 1) / stride) + 1, rows = Math.floor((ny - 1) / stride) + 1;
  const vidx = new Int32Array(rows * cols).fill(-1);
  let nv = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!isBad(data[Math.min(ny - 1, r * stride) * nx + Math.min(nx - 1, c * stride)])) vidx[r * cols + c] = nv++;
  }
  if (!nv) return null;
  const pos = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), values = new Float32Array(nv);
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const zAt = (r, c) => { const v = data[Math.min(ny - 1, Math.max(0, r * stride)) * nx + Math.min(nx - 1, Math.max(0, c * stride))]; return isBad(v) ? NaN : v; };
  const sx = 2 * stride * dx, sy = 2 * stride * dy;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const vi = vidx[r * cols + c]; if (vi < 0) continue;
    const gr = Math.min(ny - 1, r * stride), gc = Math.min(nx - 1, c * stride), z = data[gr * nx + gc];
    const px = (x0 + gc * dx) - o[0], py = (y0 - gr * dy) - o[1], pz = flat ? flatLocal : z - o[2];
    pos[vi * 3] = px; pos[vi * 3 + 1] = py; pos[vi * 3 + 2] = pz; values[vi] = z;
    if (px < bb[0]) bb[0] = px; if (py < bb[1]) bb[1] = py; if (pz < bb[2]) bb[2] = pz;
    if (px > bb[3]) bb[3] = px; if (py > bb[4]) bb[4] = py; if (pz > bb[5]) bb[5] = pz;
    if (flat) { normal[vi * 3] = 0; normal[vi * 3 + 1] = 0; normal[vi * 3 + 2] = 1; continue; }   // flat sheet → up
    // heightfield normal N = (-∂z/∂x, -∂z/∂y, 1); y decreases as row increases
    let zl = zAt(r, c - 1), zr = zAt(r, c + 1), zdn = zAt(r - 1, c), zup = zAt(r + 1, c);
    if (Number.isNaN(zl)) zl = z; if (Number.isNaN(zr)) zr = z; if (Number.isNaN(zdn)) zdn = z; if (Number.isNaN(zup)) zup = z;
    const nX = -(zr - zl) / sx, nY = -(zdn - zup) / sy, nZ = 1, nl = Math.hypot(nX, nY, nZ) || 1;
    normal[vi * 3] = nX / nl; normal[vi * 3 + 1] = nY / nl; normal[vi * 3 + 2] = nZ / nl;
  }
  const tris = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = vidx[r * cols + c], b = vidx[r * cols + c + 1], d = vidx[(r + 1) * cols + c], e = vidx[(r + 1) * cols + c + 1];
    if (a < 0 || b < 0 || d < 0 || e < 0) continue;        // drop quads touching nodata → clean holes
    tris.push(a, d, b, b, d, e);
  }
  return { kind: 'mesh', pos, idx: Uint32Array.from(tris), normal, values, count: (tris.length / 3) | 0, vertexCount: nv, bboxLocal: Float64Array.from(bb) };
}

// ── src/core/soup-geom.js ──

// @gcu/condenser — streaming-tier meshes (micro-layers §7, tier 2): TRIANGLE
// SOUP under the full chunk discipline. Photogrammetry-scale meshes (10⁷–10⁸
// tris) get what points get: batch-Morton on centroids, intra-chunk shuffle
// (any prefix = a uniform subsample — valid because triangle size
// anti-correlates with mesh size: a mesh is huge BECAUSE its triangles are
// pixel-scale, and pixel-scale triangles subsample like points), per-chunk u16
// quantization (~18 B/tri resident), budgeted progressive accumulation.
// Flat shading needs no stored normals (screen-space derivatives in-shader).
// Soup carries no records in v1 — context semantics at scale.
//
// Precision: streamed vertices are kept Float32 LOCAL to a provisional origin
// (the first vertex) — world-f32 at UTM magnitudes loses ~1 m, local-f32 keeps
// mm — and re-widened to world f64 on emit for the frame-local rebase.


/**
 * Build one SoupChunk from columnar world-space corners + centroids.
 * raw = { ax..az, bx..bz, cx..cz (corners), x,y,z (centroids) }.
 * Corners are u16-quantized against the chunk bbox (the points trick ×3).
 */
function buildSoupChunk(raw, frame, rnd, indices = null) {
  const n = indices ? indices.length : raw.x.length;
  const o = frame.origin;
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const C = [raw.ax, raw.ay, raw.az, raw.bx, raw.by, raw.bz, raw.cx, raw.cy, raw.cz];
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    for (let c = 0; c < 9; c++) {
      const a = c % 3, v = C[c][i] - o[a];
      if (v < bb[a]) bb[a] = v;
      if (v > bb[a + 3]) bb[a + 3] = v;
    }
  }
  const sx = bb[3] > bb[0] ? 65535 / (bb[3] - bb[0]) : 0;
  const sy = bb[4] > bb[1] ? 65535 / (bb[4] - bb[1]) : 0;
  const sz = bb[5] > bb[2] ? 65535 / (bb[5] - bb[2]) : 0;
  const S = [sx, sy, sz];
  const tri = new Uint16Array(9 * n);
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    for (let c = 0; c < 9; c++) {
      const a = c % 3;
      tri[k * 9 + c] = ((C[c][i] - o[a] - bb[a]) * S[a] + 0.5) | 0;
    }
  }
  return { kind: 'soup', count: n, tri, bboxLocal: Float64Array.from(bb) };
}

// Exact centroid of element k, frame-local (tests).
function soupLocalCentroid(chunk, k) {
  const b = chunk.bboxLocal, t = chunk.tri;
  const d = (v, a) => (b[a + 3] > b[a] ? b[a] + (v / 65535) * (b[a + 3] - b[a]) : b[a]);
  const out = [0, 0, 0];
  for (let c = 0; c < 9; c++) out[c % 3] += d(t[k * 9 + c], c % 3) / 3;
  return out;
}

/**
 * SoupChunkBuilder — the sticks builder's shape over triangle RawChunks
 * ({ count, ax..cz, x,y,z }). Batch-Morton on centroids, sliced, shuffled.
 */
function createSoupChunkBuilder({ frame, chunkSize = 1 << 17, batchSize = 0, seed = 1, onChunk }) {
  const rnd = mulberry32(seed);
  const batchN = batchSize || chunkSize * 4;
  let pend = [], pendCount = 0;
  const doc = {
    count: 0,
    bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity),
  };
  const concat = (Type, parts) => {
    const out = new Type(parts.reduce((t, p) => t + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const COLS = ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'cx', 'cy', 'cz', 'x', 'y', 'z'];
  const flushBatch = () => {
    if (!pendCount) return;
    const cols = {};
    for (const c of COLS) cols[c] = concat(Float64Array, pend.map((p) => p[c]));
    const n = pendCount;
    pend = []; pendCount = 0;
    const order = radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n);
    for (let start = 0; start < n; start += chunkSize) {
      const slice = order.subarray(start, Math.min(start + chunkSize, n));
      const chunk = buildSoupChunk(cols, frame, rnd, slice);
      doc.count += chunk.count;
      const b = doc.bboxLocal, cb = chunk.bboxLocal;
      for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
      onChunk(chunk);
    }
  };
  return {
    push(raw) {
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const part = {};
        for (const c of COLS) part[c] = raw[c].subarray(taken, taken + n);
        pend.push(part);
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}

// world f64 corner columns from a resolved index triple against local-f32
// vertices + their origin (the precision dance in the header comment)
function emitBatch(verts, vo, ia, ib, ic, n) {
  const out = { count: n };
  for (const c of ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'cx', 'cy', 'cz', 'x', 'y', 'z']) out[c] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = ia[i] * 3, b = ib[i] * 3, c = ic[i] * 3;
    const AX = vo[0] + verts[a], AY = vo[1] + verts[a + 1], AZ = vo[2] + verts[a + 2];
    const BX = vo[0] + verts[b], BY = vo[1] + verts[b + 1], BZ = vo[2] + verts[b + 2];
    const CX = vo[0] + verts[c], CY = vo[1] + verts[c + 1], CZ = vo[2] + verts[c + 2];
    out.ax[i] = AX; out.ay[i] = AY; out.az[i] = AZ;
    out.bx[i] = BX; out.by[i] = BY; out.bz[i] = BZ;
    out.cx[i] = CX; out.cy[i] = CY; out.cz[i] = CZ;
    out.x[i] = (AX + BX + CX) / 3; out.y[i] = (AY + BY + CY) / 3; out.z[i] = (AZ + BZ + CZ) / 3;
  }
  return out;
}

/**
 * Soup-stream an ALREADY-PARSED mesh (oversized .msh/.obj — their formats are
 * whole-file reads anyway; the vertices are transient, the soup is resident).
 * Yields RawChunks for createSoupChunkBuilder.
 */
async function* soupFromMesh({ vertices, triangles }, { batchTris = 1 << 16 } = {}) {
  const nv = (vertices.length / 3) | 0;
  const vo = nv ? [vertices[0], vertices[1], vertices[2]] : [0, 0, 0];
  const verts = new Float32Array(3 * nv);
  for (let i = 0; i < nv; i++) {
    verts[3 * i] = vertices[3 * i] - vo[0];
    verts[3 * i + 1] = vertices[3 * i + 1] - vo[1];
    verts[3 * i + 2] = vertices[3 * i + 2] - vo[2];
  }
  const nt = (triangles.length / 3) | 0;
  const ia = new Uint32Array(batchTris), ib = new Uint32Array(batchTris), ic = new Uint32Array(batchTris);
  let n = 0;
  for (let t = 0; t < nt; t++) {
    ia[n] = triangles[3 * t]; ib[n] = triangles[3 * t + 1]; ic[n] = triangles[3 * t + 2];
    n++;
    if (n === batchTris) { yield emitBatch(verts, vo, ia, ib, ic, n); n = 0; }
  }
  if (n) yield emitBatch(verts, vo, ia, ib, ic, n);
}

// ── src/core/ratio.js ──

// the canvas's BACKING ratio — device pixels per CSS pixel as the renderer actually
// sized it. Not window.devicePixelRatio: the renderer may cap it (a phone at DPR 2.8
// renders ~2× the pixels of DPR 2 for no visible gain), and every CSS→device mapping
// — picks, marquees, splat sizes — must use the ratio the buffer really has.
function backingRatio(canvas) {
  const cw = canvas && canvas.clientWidth;
  return cw ? canvas.width / cw : ((typeof window !== 'undefined' && window.devicePixelRatio) || 1);
}

// ── src/core/gl-util.js ──

// @gcu/condenser — shared GL scaffolding (used by the splat + impostor pipelines).
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('condenser shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function makeProgram(gl, vsrc, fsrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('condenser link: ' + gl.getProgramInfoLog(p));
  return p;
}

// a shader with preprocessor defines ahead of everything but the #version line
// (a projection's program twins, gl-mip.js, are the plain ones built with `#define MIP 1`)
const withDefines = (src, defs) => (defs ? src.replace('#version 300 es\n', `#version 300 es\n${defs}\n`) : src);

// a block chunk's lattice rotation when it has none (axis-aligned), column-major mat3
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// ── src/core/gl-sticks.js ──

// @gcu/condenser — capsule impostors for drillhole sticks (micro-layers §6).
// gl-blocks' trick with a different intersection: one instanced quad per
// SEGMENT, billboarded to enclose the capsule's silhouette (spanned by the
// segment axis and the axis⊥view direction), fragment ray-capsule test with a
// real gl_FragDepth + surface normal (headlight shading). <2px → splat
// demotion; a cheap no-gl_FragDepth program serves fully-demoted far chunks.
// Radius is a live per-layer uniform (world meters) — the "stick thickness"
// knob. Mask / section / picked-glow / repaint identical to blocks.


// 4×4-Bayer screen-door opacity (see gl-mesh / gl-blocks): see-through without
// alpha blending — real depth writes stay correct, no back-to-front sort.
const SCREENDOOR$gl_sticks = `
uniform float uOpacity;
const float _BAYER[16] = float[16](0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0);
bool _screendoor() { if (uOpacity >= 0.999) return false; int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2); return uOpacity < (_BAYER[bi] + 0.5) / 16.0; }`;

const VERT$gl_sticks = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA;          // segment start, frame-local
layout(location=1) in vec3 aB;          // segment end
layout(location=2) in float aChan;      // uint16 normalized (per-chunk range)
layout(location=3) in float aCat;       // uint8 raw
layout(location=4) in uint aRec;        // uint32 partitioned record id
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uRadius;                  // stick radius, world meters
uniform float uPerspScale, uDemotePx, uPointPx, uFixedSplat, uOrtho;
uniform vec3 uFwd;
uniform int uColorMode;                 // 0 elevation | 1 channel | 2 category | 3 solid
uniform vec2 uZRange;
uniform vec2 uChanChunk;                // chunk chan min/span (dequantize)
uniform vec2 uChanDoc;                  // doc chan min/span (ramp)
uniform sampler2D uRamp;
uniform vec4 uNoData;                   // blank values (chan.js code 0 / the value texture's BLANK): rgb + a (a < 0.5 = hidden)
uniform float uNoDataOn;                // off: a blank clamps to the lowest colour, the old picture
uniform sampler2D uPalette;
uniform sampler2D uMask;
uniform float uFilterOn, uIsolate;
uniform sampler2D uSel;
uniform float uSelOn;
uniform sampler2D uCatVis;
uniform float uCatVisOn;
uniform sampler2D uRule;                // rule-code byte by record index (8192-wide)
uniform float uRuleOn;                  // rule mode: the code replaces the category
uniform sampler2D uChanTex;             // OPT-IN: raw f32 VALUE by record (8192-wide) — replaces the
uniform float uChanTexOn;               // chunk's quantized aChan in mode 1 (another interval column)
uniform uint uPicked;                   // picked RECORD (0xFFFFFFFF = none)
uniform uint uPickedLayer;              // …and the layer it belongs to
uniform uint uLayer;                    // this draw's layer (per-draw, not per-element)
uniform uvec2 uRepaint;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
flat out vec3 vA;
flat out vec3 vB;
flat out vec4 vColor;
flat out float vMode;                   // 0 = capsule, 1 = splat
flat out float vCull;
out vec2 vCorner;
out vec3 vWorldPos;
void main() {
  vec3 center = (aA + aB) * 0.5;
  vec3 axis = aB - aA;
  float len = max(length(axis), 1e-6);
  vec3 u = axis / len;
  float dist = max(distance(uEye, center), 1e-3);
  float distEff = uOrtho > 0.5 ? 1.0 : dist;
  vec3 viewDir = uOrtho > 0.5 ? uFwd : (center - uEye) / dist;
  // quad plane: the segment axis × the axis-perpendicular-to-view — encloses
  // the capsule silhouette. Axis ∥ view → any perpendicular works.
  vec3 v = cross(u, viewDir);
  float vl = length(v);
  v = vl > 1e-4 ? v / vl : normalize(abs(u.z) < 0.9 ? cross(u, vec3(0.0, 0.0, 1.0)) : cross(u, vec3(1.0, 0.0, 0.0)));
  float pxR = (len * 0.5 + uRadius) * uPerspScale / distEff;
  float demoted = max(pxR < uDemotePx ? 1.0 : 0.0, uFixedSplat);
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
  }
  // section cull: keep any capsule that TOUCHES the slab (segment support along
  // the normal + radius) — the fragment shader clips exactly (see gl-blocks).
  float secSupp = demoted > 0.5 ? 0.0 : (abs(dot(axis, uSecPlane.xyz)) * 0.5 + uRadius);
  float secCull = (uSecCfg.x > 0.5 && abs(dot(center, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y + secSupp) ? 1.0 : 0.0;
  vCull = max((uIsolate > 0.5 && m < 0.5) ? 1.0 : 0.0, secCull);
  float cls = aCat;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 wp;
  if (demoted > 0.5) {                                   // splat: camera-facing square at the center
    float quadR = max(uPointPx * 0.5, min(pxR, uPointPx * 2.0)) * distEff / uPerspScale;
    vec3 sv = normalize(cross(viewDir, v));
    wp = center + (v * corner.x + sv * corner.y) * quadR;
  } else {
    wp = center + u * (corner.x * (len * 0.5 + uRadius)) + v * (corner.y * uRadius);
  }
  gl_Position = uViewProj * vec4(wp, 1.0);
  vA = aA; vB = aB; vMode = demoted; vCorner = corner; vWorldPos = wp;
  if (uColorMode == 0) {
    float t = clamp((center.z - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    vColor = texture(uRamp, vec2(t, 0.5));
    if (vColor.a < 0.5) vCull = 1.0;                      // a hidden class: the ramp texel's alpha is 0
  } else if (uColorMode == 1) {
    float cv;
    if (uChanTexOn > 0.5) { int rc = int(aRec); cv = texelFetch(uChanTex, ivec2(rc & 8191, rc >> 13), 0).r; }
    else cv = uChanChunk.x + aChan * uChanChunk.y;
    bool blank = uChanTexOn > 0.5 ? cv < -1.0e37 : aChan < 0.5 / 65535.0;
    if (blank && uNoDataOn > 0.5) {
      vColor = vec4(uNoData.rgb, 1.0);
      if (uNoData.a < 0.5) vCull = 1.0;
    } else {
      float t = clamp((cv - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0);
      vColor = texture(uRamp, vec2(t, 0.5));
      if (vColor.a < 0.5) vCull = 1.0;
    }
  } else if (uColorMode == 2) {
    vColor = texture(uPalette, vec2((cls + 0.5) / 256.0, 0.5));
  } else {
    vColor = vec4(0.62, 0.63, 0.66, 1.0);
  }
  if (uSelOn > 0.5) {
    int rs = int(aRec);
    if (texelFetch(uSel, ivec2(rs & 8191, rs >> 13), 0).r > 0.5) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.85, 0.3), 0.55), vColor.a);
  }
  if (uFilterOn > 0.5 && m < 0.5) vColor = vec4(vColor.rgb * 0.3, vColor.a);
  if (aRec == uPicked && uLayer == uPickedLayer) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.15, 0.7), 0.85) + 0.1, vColor.a);
  if ((uRepaint.x != 0xFFFFFFFFu || uRepaint.y != 0xFFFFFFFFu) && aRec != uRepaint.x && aRec != uRepaint.y) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const FRAG$gl_sticks = `#version 300 es
precision highp float;
flat in vec3 vA;
flat in vec3 vB;
flat in vec4 vColor;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uFwd;
uniform float uOrthoRay;
uniform float uBackoff;
uniform float uRadius;
uniform vec3 uLightDir;
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
out vec4 outColor;
${SCREENDOOR$gl_sticks}
void main() {
  if (vCull > 0.5) discard;
  if (_screendoor()) discard;           // per-layer opacity (screen-door)
  if (vMode > 0.5) {                    // demoted splat
    if (dot(vCorner, vCorner) > 1.0) discard;
    gl_FragDepth = gl_FragCoord.z;
    outColor = vColor;
    return;
  }
  vec3 ro = uOrthoRay > 0.5 ? vWorldPos - uFwd * uBackoff : uEye;
  vec3 rd = uOrthoRay > 0.5 ? uFwd : normalize(vWorldPos - uEye);
  // ray-capsule (body cylinder + cap spheres)
  vec3 ba = vB - vA;
  vec3 oa = ro - vA;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa);
  float rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard;
  float b = baba * rdoa - baoa * bard;
  float c = baba * oaoa - baoa * baoa - uRadius * uRadius * baba;
  float h = b * b - a * c;
  float t = -1.0;
  vec3 n = vec3(0.0);
  if (h >= 0.0) {
    float tb = (-b - sqrt(h)) / max(a, 1e-9);
    float y = baoa + tb * bard;
    if (y > 0.0 && y < baba && tb > 0.0) {
      t = tb;
      vec3 p = ro + rd * t;
      n = (p - vA - ba * (y / baba)) / uRadius;
    }
  }
  if (t < 0.0) {                        // the caps: try both, keep the nearest forward hit
    for (int i = 0; i < 2; i++) {
      vec3 capC = i == 0 ? vA : vB;
      vec3 o2 = ro - capC;
      float b2 = dot(rd, o2);
      float c2 = dot(o2, o2) - uRadius * uRadius;
      float h2 = b2 * b2 - c2;
      if (h2 >= 0.0) {
        float t2 = -b2 - sqrt(h2);
        if (t2 > 0.0 && (t < 0.0 || t2 < t)) {
          t = t2;
          n = (ro + rd * t2 - capC) / uRadius;
        }
      }
    }
  }
  if (t < 0.0) discard;
  // TRUE SECTION on the capsule (convex, so one inside-test at the slab face is
  // exact): a hit outside the slab either becomes the flat cut CROSS-SECTION at
  // the face, or the capsule never overlaps the slab and the pixel is gone.
  float cutFace = 0.0;
  if (uSecCfg.x > 0.5) {
    float den = dot(rd, uSecPlane.xyz);
    float dc = dot(ro, uSecPlane.xyz) - uSecPlane.w;
    if (abs(dc + t * den) > uSecCfg.y) {
      if (abs(den) < 1e-9) discard;
      float sIn = min((-uSecCfg.y - dc) / den, (uSecCfg.y - dc) / den);
      if (sIn <= t) discard;                               // hit past the slab exit
      vec3 q = ro + rd * sIn;                              // at the slab face: still inside?
      vec3 qa = q - vA;
      float yq = clamp(dot(qa, ba) / baba, 0.0, 1.0);
      if (length(qa - ba * yq) > uRadius) discard;
      t = sIn;
      n = uSecPlane.xyz * -sign(den);
      cutFace = 1.0;
    }
  }
  vec3 p = ro + rd * t;
  vec4 clip = uViewProj * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  float shade = (0.55 + 0.45 * max(dot(n, uLightDir), 0.0)) * (cutFace > 0.5 ? 0.85 : 1.0);
  outColor = vec4(vColor.rgb * shade, vColor.a);
}`;

const FRAG_CHEAP$gl_sticks = `#version 300 es
precision highp float;
flat in vec3 vA;
flat in vec3 vB;
flat in vec4 vColor;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uLightDir;
uniform mat4 uViewProj;
out vec4 outColor;
${SCREENDOOR$gl_sticks}
void main() {
  if (vCull > 0.5) discard;
  if (_screendoor()) discard;
  if (dot(vCorner, vCorner) > 1.0) discard;
  outColor = vColor;
}`;

function createSticksPipeline(gl) {
  const mkProg = (frag) => {
    const prog = makeProgram(gl, VERT$gl_sticks, frag);
    const U = (n) => gl.getUniformLocation(prog, n);
    return { prog, uni: {
      viewProj: U('uViewProj'), eye: U('uEye'), radius: U('uRadius'), opacity: U('uOpacity'),
      perspScale: U('uPerspScale'), demotePx: U('uDemotePx'), pointPx: U('uPointPx'), fixedSplat: U('uFixedSplat'),
      colorMode: U('uColorMode'), zRange: U('uZRange'), chanChunk: U('uChanChunk'), chanDoc: U('uChanDoc'), noData: U('uNoData'), noDataOn: U('uNoDataOn'),
      ramp: U('uRamp'), palette: U('uPalette'), lightDir: U('uLightDir'),
      mask: U('uMask'), filterOn: U('uFilterOn'), isolate: U('uIsolate'), picked: U('uPicked'), pickedLayer: U('uPickedLayer'), layer: U('uLayer'), repaint: U('uRepaint'),
      catVis: U('uCatVis'), catVisOn: U('uCatVisOn'), sel: U('uSel'), selOn: U('uSelOn'),
      rule: U('uRule'), ruleOn: U('uRuleOn'), chanTex: U('uChanTex'), chanTexOn: U('uChanTexOn'),
      secPlane: U('uSecPlane'), secCfg: U('uSecCfg'),
      ortho: U('uOrtho'), fwd: U('uFwd'), orthoRay: U('uOrthoRay'), backoff: U('uBackoff'),
    } };
  };
  const full = mkProg(FRAG$gl_sticks), cheap = mkProg(FRAG_CHEAP$gl_sticks);
  let active = full;

  function upload(chunk) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mkBuf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const bSeg = mkBuf(chunk.seg), bChan = mkBuf(chunk.chan), bCat = mkBuf(chunk.cat), bRec = mkBuf(chunk.recIdx);
    gl.bindVertexArray(null);
    return {
      kind: 'sticks', vao, buffers: [bSeg, bChan, bCat, bRec],
      bSeg, bChan, bCat, bRec,
      count: chunk.count, bboxLocal: chunk.bboxLocal, cursor: 0,
      chanRange: chunk.chanRange,
    };
  }

  function drawSlice(c, first, k, useCheap = false) {
    const pp = useCheap ? cheap : full;
    if (pp !== active) { gl.useProgram(pp.prog); active = pp; }
    const uni = active.uni;
    gl.uniform1f(uni.fixedSplat, useCheap ? 1 : 0);
    gl.bindVertexArray(c.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bSeg);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, first * 24);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, first * 24 + 12);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bChan);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_SHORT, true, 0, first * 2);
    gl.vertexAttribDivisor(2, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, 0, first);
    gl.vertexAttribDivisor(3, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, first * 4);
    gl.vertexAttribDivisor(4, 1);
    const dq = chanDequant(c.chanRange);
    gl.uniform2f(uni.chanChunk, dq[0], dq[1]);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
  }

  function begin(cam, { pointPx, colorMode, zRange, chanDoc, ramp, palette, viewportH, maskTex = null, isolate = false, pointsView = false, picked = 0xFFFFFFFF, pickedLayer = 0xFFFFFFFF, layer = 0, section = null, radius = 1, catVisTex = null, selTex = null, ruleTex = null, chanTex = null, opacity = 1, noData = null }) {
    const s = cam.state;
    for (const pp of [full, cheap]) {
      gl.useProgram(pp.prog);
      const uni = pp.uni;
      gl.uniformMatrix4fv(uni.viewProj, false, s.viewProj);
      gl.uniform3f(uni.eye, s.eye[0], s.eye[1], s.eye[2]);
      const v = s.view;
      let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
      const ll = Math.hypot(lx, ly, lz) || 1;
      lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
      const l2 = Math.hypot(lx, ly, lz) || 1;
      gl.uniform3f(uni.lightDir, lx / l2, ly / l2, lz / l2);
      gl.uniform1f(uni.radius, radius);
      gl.uniform1f(uni.opacity, Math.max(0.02, Math.min(1, opacity)));   // per-layer screen-door opacity
      gl.uniform1f(uni.perspScale, s.ortho ? (viewportH / 2) / s.halfH : (viewportH / 2) / Math.tan(s.fovY / 2));
      gl.uniform1f(uni.ortho, s.ortho ? 1 : 0);
      gl.uniform1f(uni.orthoRay, s.ortho ? 1 : 0);
      {
        const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
        const fl = Math.hypot(...f) || 1;
        gl.uniform3f(uni.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
        gl.uniform1f(uni.backoff, s.radius * 2);
      }
      gl.uniform1f(uni.demotePx, 2.0);
      gl.uniform1f(uni.pointPx, pointPx * backingRatio(gl.canvas));
      gl.uniform1i(uni.colorMode, colorMode);
      gl.uniform2f(uni.zRange, zRange[0], zRange[1]);
      gl.uniform2f(uni.chanDoc, chanDoc[0], chanDoc[1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ramp); gl.uniform1i(uni.ramp, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, palette); gl.uniform1i(uni.palette, 1);
      gl.uniform1f(uni.fixedSplat, pointsView ? 1 : 0);
      gl.uniform1ui(uni.picked, picked >>> 0);
      gl.uniform1ui(uni.pickedLayer, pickedLayer >>> 0);
      gl.uniform1ui(uni.layer, layer >>> 0);              // this draw's layer — the id no longer hides in aRec
      gl.uniform2ui(uni.repaint, 0xFFFFFFFF, 0xFFFFFFFF);
      gl.uniform4f(uni.secPlane, section ? section.n[0] : 0, section ? section.n[1] : 0, section ? section.n[2] : 1, section ? section.d : 0);
      gl.uniform2f(uni.secCfg, section ? 1 : 0, section ? section.half : 0);
      gl.uniform1f(uni.filterOn, maskTex ? 1 : 0);
      gl.uniform1f(uni.isolate, isolate ? 1 : 0);
      if (maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(uni.mask, 4); }
      gl.uniform1f(uni.catVisOn, catVisTex ? 1 : 0);
      if (catVisTex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, catVisTex); gl.uniform1i(uni.catVis, 5); }
      gl.uniform1f(uni.selOn, selTex ? 1 : 0);
      if (selTex) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, selTex); gl.uniform1i(uni.sel, 6); }
      gl.uniform1f(uni.ruleOn, ruleTex ? 1 : 0);
      if (ruleTex) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, ruleTex); gl.uniform1i(uni.rule, 7); }
      gl.uniform1f(uni.chanTexOn, chanTex ? 1 : 0);
      gl.uniform1f(uni.noDataOn, noData ? 1 : 0);
      if (noData) gl.uniform4f(uni.noData, noData[0], noData[1], noData[2], noData[3]);
      if (chanTex) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, chanTex); gl.uniform1i(uni.chanTex, 8); }
    }
    active = full;
    gl.useProgram(full.prog);
  }

  function setRepaint(a, b) {
    for (const pp of [full, cheap]) { gl.useProgram(pp.prog); gl.uniform2ui(pp.uni.repaint, a >>> 0, b >>> 0); }
    if (active) gl.useProgram(active.prog);
  }

  return { upload, drawSlice, begin, setRepaint };
}

// ── src/core/gl-mesh.js ──

// @gcu/condenser — the context-mesh pipeline (micro-layers §7, tier 1).
// Static indexed triangles: one VAO + element buffer per mesh, drawn whole on
// clear frames (no prefix, no budget — the tier is bounded at open). Flat
// shading comes from screen-space derivatives (no normals buffer), two-sided
// (geological wireframes are rarely consistently wound). The section cut is
// PER-PIXEL — a triangle crossing the plane is clipped at it, not dropped —
// which is exactly the sectioned-solid view. Opacity is 4×4-Bayer screen-door:
// depth-correct, blend-free, safe under progressive accumulation and EDL.


const VERT$gl_mesh = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;        // frame-local vertex
layout(location=1) in vec3 aColor;      // per-vertex rgb (heightfield drape); ignored when uVColor=0
layout(location=2) in vec3 aNormal;     // per-vertex normal (smooth relief); ignored when uVNormal=0
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
out vec3 vWorldPos;
out vec3 vColor;
out vec3 vNormal;
out float vSecDist;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vWorldPos = aPos;
  vColor = aColor;
  vNormal = aNormal;
  vSecDist = dot(aPos, uSecPlane.xyz) - uSecPlane.w;
}`;

// Per-vertex drape (uVColor) + smooth normals (uVNormal) are OPT-IN — default 0
// keeps the flat-shaded solid-tint behavior byte-for-byte. The heightfield
// surface sets both: vColor from a colormap, vNormal from the grid gradient, and
// the normal's z is divided by uZExag (inverse-transpose of the display z-scale)
// so lighting matches the vertically-exaggerated relief.
const SHADE_COMMON = `
uniform vec4 uTint;                     // rgb + opacity
uniform vec3 uLightDir;
uniform vec3 uEye;
uniform float uVColor;                  // 0/1 use vColor
uniform float uVNormal;                 // 0/1 use vNormal (else flat derivative)
uniform float uZExag;                   // vertical exaggeration (for the normal correction)
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
vec3 shadeSurface() {
  vec3 n = (uVNormal > 0.5)
    ? normalize(vec3(vNormal.xy, vNormal.z / max(uZExag, 1e-4)))   // exaggeration-correct
    : normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));          // flat shading
  vec3 vd = normalize(uEye - vWorldPos);
  if (dot(n, vd) < 0.0) n = -n;                                    // two-sided
  float shade = 0.42 + 0.58 * max(dot(n, uLightDir), 0.0);
  vec3 base = (uVColor > 0.5) ? vColor : uTint.rgb;
  return base * shade;
}`;

const FRAG$gl_mesh = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vColor;
in vec3 vNormal;
in float vSecDist;
uniform vec2 uSecCfg;                   // x: on, y: half-thickness
${SHADE_COMMON}
out vec4 outColor;
void main() {
  if (uSecCfg.x > 0.5 && abs(vSecDist) > uSecCfg.y) discard;   // per-pixel plane cut
  if (uTint.a < 0.999) {
    int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2);
    if (uTint.a < (BAYER[bi] + 0.5) / 16.0) discard;
  }
  outColor = vec4(shadeSurface(), 1.0);
}`;

// TRACE-OVER-THE-WALL variant, used while the layer is sectioned: with blocks
// cutting TRUE at the slab plane (gl-blocks), the mesh inside the slab sits
// BEHIND the painted cut wall and would be fully occluded — and the mesh AT the
// plane is edge-on (invisible). This program pulls each in-slab fragment's DEPTH
// onto the camera-side slab face (minus an epsilon), so the whole in-slab mesh
// projects onto the section and draws over the wall — the wireframe-trace-on-a-
// section-plot look. Color/shading unchanged; costs early-z only while sectioned.
const FRAG_OVERLAY$gl_mesh = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vColor;
in vec3 vNormal;
in float vSecDist;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform mat4 uViewProj;
uniform vec3 uFwd;
uniform float uOrtho;
${SHADE_COMMON}
out vec4 outColor;
void main() {
  if (abs(vSecDist) > uSecCfg.y) discard;
  if (uTint.a < 0.999) {
    int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2);
    if (uTint.a < (BAYER[bi] + 0.5) / 16.0) discard;
  }
  outColor = vec4(shadeSurface(), 1.0);
  gl_FragDepth = gl_FragCoord.z;
  float dcEye = dot(uEye, uSecPlane.xyz) - uSecPlane.w;
  if (abs(dcEye) > uSecCfg.y) {                            // eye outside the slab → a wall may occlude
    float side = sign(dcEye);
    vec3 q; bool front = false;
    if (uOrtho > 0.5) {                                    // parallel rays: march back along the view dir
      float den = dot(uFwd, uSecPlane.xyz);
      if (abs(den) > 1e-9) {
        float s = (vSecDist - side * uSecCfg.y) / den;
        if (s > 0.0) { q = vWorldPos - uFwd * s; front = true; }
      }
    } else {
      vec3 rdm = vWorldPos - uEye;
      float den = dot(rdm, uSecPlane.xyz);
      if (abs(den) > 1e-9) {
        float tF = (side * uSecCfg.y - dcEye) / den;       // where the eye ray crosses the near face
        if (tF > 0.0 && tF < 1.0) { q = uEye + rdm * tF; front = true; }
      }
    }
    if (front) {
      vec4 clipQ = uViewProj * vec4(q, 1.0);
      gl_FragDepth = clamp(clipQ.z / clipQ.w * 0.5 + 0.5, 0.0, 1.0) - 3e-5;
    }
  }
}`;

function createMeshPipeline(gl) {
  const mk = (frag) => {
    const prog = makeProgram(gl, VERT$gl_mesh, frag);
    const U = (n) => gl.getUniformLocation(prog, n);
    return { prog, uni: {
      viewProj: U('uViewProj'), secPlane: U('uSecPlane'), secCfg: U('uSecCfg'),
      tint: U('uTint'), lightDir: U('uLightDir'), eye: U('uEye'),
      fwd: U('uFwd'), ortho: U('uOrtho'),
      vColor: U('uVColor'), vNormal: U('uVNormal'), zExag: U('uZExag'),
    } };
  };
  const base = mk(FRAG$gl_mesh), overlay = mk(FRAG_OVERLAY$gl_mesh);

  function upload(chunk) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = [];
    const bPos = gl.createBuffer(); bufs.push(bPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
    gl.bufferData(gl.ARRAY_BUFFER, chunk.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    let bCol = null;
    if (chunk.color) {                                     // heightfield drape: per-vertex rgb (loc 1)
      bCol = gl.createBuffer(); bufs.push(bCol);
      gl.bindBuffer(gl.ARRAY_BUFFER, bCol);
      gl.bufferData(gl.ARRAY_BUFFER, chunk.color, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    }
    if (chunk.normal) {                                    // smooth relief: per-vertex normal (loc 2)
      const bNrm = gl.createBuffer(); bufs.push(bNrm);
      gl.bindBuffer(gl.ARRAY_BUFFER, bNrm);
      gl.bufferData(gl.ARRAY_BUFFER, chunk.normal, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    }
    const bIdx = gl.createBuffer(); bufs.push(bIdx);       // stays bound in the VAO
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunk.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return {
      kind: 'mesh', vao, buffers: bufs, colorBuf: bCol,
      count: chunk.count, idxCount: chunk.idx.length, vertexCount: (chunk.pos.length / 3) | 0,
      hasColor: !!chunk.color, hasNormal: !!chunk.normal,
      bboxLocal: chunk.bboxLocal, cursor: 0,
    };
  }

  // Replace a mesh's per-vertex colours after upload — painting a set onto an outcrop
  // recolours a few thousand vertices per stroke, and rebuilding the chunk would
  // re-send the whole mesh. rgb: Float32Array(3·vertexCount), or null to go back to
  // the tint. [lo, hi) limits the upload to the vertex range a stroke touched (the
  // array is still the WHOLE mesh's; only that slice is sent).
  function setColor(c, rgb, lo = 0, hi = c.vertexCount) {
    if (!rgb) { c.hasColor = false; return; }
    if (rgb.length < c.vertexCount * 3) throw new Error(`setColor: ${rgb.length / 3} colours for ${c.vertexCount} vertices`);
    if (!c.colorBuf) {                                     // first colours: a buffer the size of the mesh
      c.colorBuf = gl.createBuffer(); c.buffers.push(c.colorBuf);
      gl.bindVertexArray(c.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, c.colorBuf);
      gl.bufferData(gl.ARRAY_BUFFER, rgb.subarray(0, c.vertexCount * 3), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      c.bytes = (c.bytes || 0) + c.vertexCount * 12;
    } else {
      lo = Math.max(0, lo | 0); hi = Math.min(c.vertexCount, hi | 0);
      if (hi > lo) {
        gl.bindBuffer(gl.ARRAY_BUFFER, c.colorBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, lo * 12, rgb, lo * 3, (hi - lo) * 3);
      }
    }
    c.hasColor = true;
  }

  // per-layer uniforms — tint [r,g,b] 0..1, opacity 0..1, section may be null.
  // Sectioned → the overlay program (depth flattened onto the slab face so the
  // trace draws over the true-cut block wall); unsectioned → the base program.
  function begin(cam, { tint = [0.62, 0.64, 0.66], opacity = 1, section = null, vcolor = false, vnormal = false }) {
    const s = cam.state;
    const { prog, uni } = section ? overlay : base;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uni.viewProj, false, s.viewProj);
    gl.uniform1f(uni.vColor, vcolor ? 1 : 0);              // heightfield drape colors
    gl.uniform1f(uni.vNormal, vnormal ? 1 : 0);            // smooth grid normals
    gl.uniform1f(uni.zExag, s.zExag || 1);                 // normal correction under exaggeration
    gl.uniform3f(uni.eye, s.eye[0], s.eye[1], s.eye[2]);
    // the headlight of blocks/sticks: eye direction + a little up
    const v = s.view;
    let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
    const l2 = Math.hypot(lx, ly, lz) || 1;
    gl.uniform3f(uni.lightDir, lx / l2, ly / l2, lz / l2);
    gl.uniform4f(uni.tint, tint[0], tint[1], tint[2], Math.max(0.02, Math.min(1, opacity)));
    gl.uniform4f(uni.secPlane, section ? section.n[0] : 0, section ? section.n[1] : 0, section ? section.n[2] : 1, section ? section.d : 0);
    gl.uniform2f(uni.secCfg, section ? 1 : 0, section ? section.half : 0);
    if (uni.fwd) {
      const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
      const fl = Math.hypot(...f) || 1;
      gl.uniform3f(uni.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
      gl.uniform1f(uni.ortho, s.ortho ? 1 : 0);
    }
  }

  function draw(c) {
    gl.bindVertexArray(c.vao);
    gl.drawElements(gl.TRIANGLES, c.idxCount, gl.UNSIGNED_INT, 0);
  }

  return { upload, begin, draw, setColor };
}

// ── src/core/gl-soup.js ──

// @gcu/condenser — the streaming-mesh (triangle soup) pipeline (micro-layers
// §7 tier 2). The points pipeline's shape over TRIANGLES: u16 positions
// dequantized against the chunk bbox, prefix slices (first/k in TRIANGLE
// units), budgeted accumulation. The fragment shader is gl-mesh's: derivative
// flat shading, two-sided, Bayer screen-door opacity, per-pixel section cut.


const VERT$gl_soup = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;        // u16 normalized against the chunk bbox
uniform mat4 uViewProj;
uniform vec3 uBoxMin;
uniform vec3 uBoxSpan;
uniform vec4 uSecPlane;
out vec3 vWorldPos;
out float vSecDist;
void main() {
  vec3 p = uBoxMin + aPos * uBoxSpan;
  gl_Position = uViewProj * vec4(p, 1.0);
  vWorldPos = p;
  vSecDist = dot(p, uSecPlane.xyz) - uSecPlane.w;
}`;

const FRAG$gl_soup = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in float vSecDist;
uniform vec2 uSecCfg;
uniform vec4 uTint;
uniform vec3 uLightDir;
uniform vec3 uEye;
out vec4 outColor;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  if (uSecCfg.x > 0.5 && abs(vSecDist) > uSecCfg.y) discard;
  if (uTint.a < 0.999) {
    int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2);
    if (uTint.a < (BAYER[bi] + 0.5) / 16.0) discard;
  }
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 vd = normalize(uEye - vWorldPos);
  if (dot(n, vd) < 0.0) n = -n;
  float shade = 0.42 + 0.58 * max(dot(n, uLightDir), 0.0);
  outColor = vec4(uTint.rgb * shade, 1.0);
}`;

// sectioned variant: flatten in-slab fragment depth onto the camera-side slab
// face so the streamed-mesh trace draws over the true-cut block wall (gl-mesh's
// FRAG_OVERLAY, same math — see the rationale there)
const FRAG_OVERLAY$gl_soup = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in float vSecDist;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform vec4 uTint;
uniform vec3 uLightDir;
uniform vec3 uEye;
uniform mat4 uViewProj;
uniform vec3 uFwd;
uniform float uOrtho;
out vec4 outColor;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  if (abs(vSecDist) > uSecCfg.y) discard;
  if (uTint.a < 0.999) {
    int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2);
    if (uTint.a < (BAYER[bi] + 0.5) / 16.0) discard;
  }
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 vd = normalize(uEye - vWorldPos);
  if (dot(n, vd) < 0.0) n = -n;
  float shade = 0.42 + 0.58 * max(dot(n, uLightDir), 0.0);
  outColor = vec4(uTint.rgb * shade, 1.0);
  gl_FragDepth = gl_FragCoord.z;
  float dcEye = dot(uEye, uSecPlane.xyz) - uSecPlane.w;
  if (abs(dcEye) > uSecCfg.y) {
    float side = sign(dcEye);
    vec3 q; bool front = false;
    if (uOrtho > 0.5) {
      float den = dot(uFwd, uSecPlane.xyz);
      if (abs(den) > 1e-9) {
        float s = (vSecDist - side * uSecCfg.y) / den;
        if (s > 0.0) { q = vWorldPos - uFwd * s; front = true; }
      }
    } else {
      vec3 rdm = vWorldPos - uEye;
      float den = dot(rdm, uSecPlane.xyz);
      if (abs(den) > 1e-9) {
        float tF = (side * uSecCfg.y - dcEye) / den;
        if (tF > 0.0 && tF < 1.0) { q = uEye + rdm * tF; front = true; }
      }
    }
    if (front) {
      vec4 clipQ = uViewProj * vec4(q, 1.0);
      gl_FragDepth = clamp(clipQ.z / clipQ.w * 0.5 + 0.5, 0.0, 1.0) - 3e-5;
    }
  }
}`;

function createSoupPipeline(gl) {
  const mk = (frag) => {
    const prog = makeProgram(gl, VERT$gl_soup, frag);
    const U = (n) => gl.getUniformLocation(prog, n);
    return { prog, uni: {
      viewProj: U('uViewProj'), boxMin: U('uBoxMin'), boxSpan: U('uBoxSpan'),
      secPlane: U('uSecPlane'), secCfg: U('uSecCfg'),
      tint: U('uTint'), lightDir: U('uLightDir'), eye: U('uEye'),
      fwd: U('uFwd'), ortho: U('uOrtho'),
    } };
  };
  const base = mk(FRAG$gl_soup), overlay = mk(FRAG_OVERLAY$gl_soup);
  let uni = base.uni;                                      // drawSlice uses the ACTIVE program's locations

  function upload(chunk) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, chunk.tri, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, 0, 0);
    gl.bindVertexArray(null);
    return {
      kind: 'soup', vao, buffers: [b],
      count: chunk.count, bboxLocal: chunk.bboxLocal, cursor: 0,
    };
  }

  function begin(cam, { tint = [0.62, 0.64, 0.66], opacity = 1, section = null }) {
    const s = cam.state;
    const pp = section ? overlay : base;
    uni = pp.uni;
    gl.useProgram(pp.prog);
    gl.uniformMatrix4fv(uni.viewProj, false, s.viewProj);
    gl.uniform3f(uni.eye, s.eye[0], s.eye[1], s.eye[2]);
    const v = s.view;
    let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
    const l2 = Math.hypot(lx, ly, lz) || 1;
    gl.uniform3f(uni.lightDir, lx / l2, ly / l2, lz / l2);
    gl.uniform4f(uni.tint, tint[0], tint[1], tint[2], Math.max(0.02, Math.min(1, opacity)));
    gl.uniform4f(uni.secPlane, section ? section.n[0] : 0, section ? section.n[1] : 0, section ? section.n[2] : 1, section ? section.d : 0);
    gl.uniform2f(uni.secCfg, section ? 1 : 0, section ? section.half : 0);
    if (uni.fwd) {
      const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
      const fl = Math.hypot(...f) || 1;
      gl.uniform3f(uni.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
      gl.uniform1f(uni.ortho, s.ortho ? 1 : 0);
    }
  }

  // first/k in TRIANGLES — the prefix invariant rides the shuffled build order
  function drawSlice(c, first, k) {
    gl.bindVertexArray(c.vao);
    gl.uniform3f(uni.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
    gl.uniform3f(uni.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
    gl.drawArrays(gl.TRIANGLES, first * 3, k * 3);
  }

  return { upload, begin, drawSlice };
}

// ── src/core/camera.js ──

// @gcu/condenser — minimal mat4 math + an orbit camera. Raw WebGL2 needs ~four
// matrix ops, not a scene graph (dee's camera is Three-coupled — micro-spec §5
// says borrow the *math*, and the math is textbook, so it lives here).
// Column-major Float32Array(16), GL convention. All coordinates FRAME-LOCAL —
// the document frame keeps magnitudes small enough for f32 uniforms.

function mat4Perspective(fovYRad, aspect, near, far) {
  const f = 1 / Math.tan(fovYRad / 2), nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) * nf; m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function mat4Ortho(halfH, aspect, near, far) {
  const halfW = halfH * aspect, m = new Float32Array(16);
  m[0] = 1 / halfW; m[5] = 1 / halfH;
  m[10] = -2 / (far - near); m[14] = -(far + near) / (far - near);
  m[15] = 1;
  return m;
}

function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[4] = xy; m[8] = xz; m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[1] = yx; m[5] = yy; m[9] = yz; m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[2] = zx; m[6] = zy; m[10] = zz; m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function mat4Multiply(a, b) {                       // a·b (both column-major)
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    m[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return m;
}

// General 4×4 inverse (cofactor expansion, column-major). Used to unproject
// (pixel, depth) → world in the deferred re-shade resolve; the viewProj is
// always invertible for a real camera. Returns null on a singular matrix.
function mat4Inverse(m) {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!det) return null;
  const d = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= d;
  return inv;
}

// Frustum planes from a viewProj matrix (Gribb–Hartmann, column-major): six
// [a,b,c,d] rows — a point is inside when a·x+b·y+c·z+d ≥ 0 for all six.
function frustumPlanes(m) {
  const row = (r) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
  return [add(r3, r0), sub(r3, r0), add(r3, r1), sub(r3, r1), add(r3, r2), sub(r3, r2)];
}

// Conservative AABB-vs-frustum: positive-vertex test — the box is out only when
// its most-positive corner for some plane is still behind that plane.
function aabbInFrustum(planes, b) {                 // b = [minX,minY,minZ,maxX,maxY,maxZ]
  for (const [a, bb, c, d] of planes) {
    const px = a > 0 ? b[3] : b[0], py = bb > 0 ? b[4] : b[1], pz = c > 0 ? b[5] : b[2];
    if (a * px + bb * py + c * pz + d < 0) return false;
  }
  return true;
}

function transformPoint(m, p) {                     // m · [p,1] → perspective divide
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/**
 * Orbit camera: target + spherical (radius, theta around Z, phi from the XY
 * plane). Z-up (geology convention). Produces eye/view/proj; near/far adapt to
 * the orbit radius each update (dee's depth-precision trick).
 */
// A camera state that draws geometry at p as the original draws p + o — a layer
// offset as a change of camera, not of geometry. view/viewProj gain a trailing
// translation; eye and target move by −o, so every shader that works from
// (p − eye), the view's rotation columns and viewProj (block/stick raycasts,
// gl_FragDepth, the headlight) stays exact. Section planes must be shifted the
// same way by the caller (d − n·o). Under vertical exaggeration the offset's z
// stretches with everything else, since the z-scale lives inside viewProj.
function translateState(s, o) {
  if (!o) return s;
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, o[0], o[1], o[2], 1];
  return {
    ...s,
    eye: [s.eye[0] - o[0], s.eye[1] - o[1], s.eye[2] - o[2]],
    target: [s.target[0] - o[0], s.target[1] - o[1], s.target[2] - o[2]],
    view: mat4Multiply(s.view, T),
    viewProj: mat4Multiply(s.viewProj, T),
  };
}

function createOrbitCamera({ fovY = 45 * Math.PI / 180 } = {}) {
  const c = {
    target: [0, 0, 0], radius: 100, theta: Math.PI / 4, phi: Math.PI / 5, fovY,
    aspect: 1, near: 0.1, far: 1e6,
    ortho: false, halfH: 0,                                // ortho: half-height = radius·tan(fovY/2) — toggling keeps apparent size at the target
    zExag: 1,                                              // vertical exaggeration: a GLOBAL scene z-scale folded into viewProj (all layers stay registered; queries stay in real coords — see update())
    phiEps: 0.01,                                          // how close to straight up/down an ORBIT may go; a locked plan view sets 0 (exact)
    orbitLock: false,                                      // locked views: a drag pans, a pinch doesn't twist (unless twist)
    twist: false,                                          // with orbitLock: ctrl-drag / pinch-twist may still turn about the vertical
    eye: [0, 0, 0], view: null, proj: null, viewProj: null,
  };
  function update() {
    const EPS = c.phiEps == null ? 0.01 : c.phiEps;
    c.phi = Math.max(-Math.PI / 2 + EPS, Math.min(Math.PI / 2 - EPS, c.phi));
    c.radius = Math.max(0.05, c.radius);
    const cp = Math.cos(c.phi);
    c.eye = [
      c.target[0] + c.radius * cp * Math.cos(c.theta),
      c.target[1] + c.radius * cp * Math.sin(c.theta),
      c.target[2] + c.radius * Math.sin(c.phi),
    ];
    // near at radius/4000: on a km-scale fitted model the old /1000 put the
    // clip plane METRES in front of the camera — visible slicing when panning
    // close past geometry. /4000 keeps depth precision under a block size at
    // the far end of a 24-bit buffer (error ~ z²/(near·2²⁴): ~3 m at z=10 km
    // with near 2.5 m) while clipping 4× closer.
    c.near = Math.max(c.radius / 4000, 0.01);
    c.far = c.radius * 100;
    // the camera's own up — z-up projected off the view direction. The same matrix as
    // lookAt(…, [0,0,1]) everywhere that one is defined, and still defined looking
    // STRAIGHT down, where z-up is parallel to the view (an exact plan view).
    const sp = Math.sin(c.phi), ct = Math.cos(c.theta), st = Math.sin(c.theta);
    c.view = mat4LookAt(c.eye, c.target, [-ct * sp, -st * sp, cp]);
    c.halfH = c.radius * Math.tan(c.fovY / 2);
    c.proj = c.ortho ? mat4Ortho(c.halfH, c.aspect, c.near, c.far) : mat4Perspective(c.fovY, c.aspect, c.near, c.far);
    c.viewProj = mat4Multiply(c.proj, c.view);
    // Vertical exaggeration: fold a world-space z-scale into viewProj, pivoted at
    // the target's z (so the look-at point stays fixed). viewProj·M means every
    // vertex is z-scaled AT DRAW ONLY — shaders still test real z for section
    // culling (before viewProj), pick is the ID-buffer (real recIdx), measure
    // reads source records, and unproject uses inverse(viewProj) which yields real
    // coords. One matrix, all layers registered, every query honest.
    if (c.zExag && c.zExag !== 1) {
      const S = c.zExag, tz = c.target[2];                 // z' = tz + (z-tz)·S  ⇒  column-major z-scale about tz
      c.viewProj = mat4Multiply(c.viewProj, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, S, 0, 0, 0, tz * (1 - S), 1]);
    }
    return c;
  }
  return {
    get state() { return c; },
    update,
    setAspect(a) { c.aspect = a || 1; return update(); },
    orbit(dTheta, dPhi) { c.theta += dTheta; c.phi += dPhi; return update(); },
    dolly(f) { c.radius *= f; return update(); },
    pan(dxPx, dyPx, viewportH) {                           // screen px → world at target depth
      const s = 2 * c.radius * Math.tan(c.fovY / 2) / (viewportH || 1);
      const ct = Math.cos(c.theta), st = Math.sin(c.theta), sp = Math.sin(c.phi), cp = Math.cos(c.phi);
      // camera right = (-st, ct, 0); camera up ≈ (-ct·sp, -st·sp, cp)
      c.target[0] += (-st) * (-dxPx * s) + (-ct * sp) * (dyPx * s);
      c.target[1] += (ct) * (-dxPx * s) + (-st * sp) * (dyPx * s);
      // vertical exaggeration stretches displayed z by zExag, so a real-z move
      // shows amplified — divide the up-vector's z contribution by zExag so the
      // grabbed point tracks the cursor 1:1 (M⁻¹ of the up-move; x/y are unscaled).
      // In plan view cp=0 → no change, as it should be.
      c.target[2] += cp * (dyPx * s) / (c.zExag || 1);
      return update();
    },
    setOrtho(on) { c.ortho = !!on; return update(); },
    fit(bbox) {                                            // frame a local-space bbox
      c.target = [(bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2];
      const dx = bbox[3] - bbox[0], dy = bbox[4] - bbox[1], dz = bbox[5] - bbox[2];
      const d = Math.hypot(dx, dy, dz) || 1;
      c.radius = (d / 2) / Math.tan(c.fovY / 2) * 1.2;
      return update();
    },
  };
}

// Wire standard mouse/touch input onto an orbit camera. Returns a detach fn.
// left-drag orbit · right-drag / shift-drag pan · wheel dolly.
function attachOrbitInput(canvas, cam, { onChange } = {}) {
  // pointers tracked by id: one = orbit (or pan with right-button/shift),
  // two = the touch grammar — pinch dollies, the centroid pans, twist orbits
  // theta. touch-action:none or the browser eats the gestures first.
  canvas.style.touchAction = 'none';
  const pts = new Map();
  let mode = null, lx = 0, ly = 0;
  let pinch = null;                                        // { span, cx, cy, angle }
  const pinchState = () => {
    const [a, b] = [...pts.values()];
    return {
      span: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };
  const down = (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    if (pts.size === 2) { pinch = pinchState(); mode = 'pinch'; return; }
    if (pts.size > 2) return;                              // third finger: ignore
    mode = (e.button === 2 || e.shiftKey) ? 'pan' : (e.ctrlKey && cam.state.orbitLock && cam.state.twist) ? 'twist' : 'orbit';
    lx = e.clientX; ly = e.clientY;
  };
  const move = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch' && pts.size >= 2) {
      const now = pinchState();
      cam.dolly(pinch.span / now.span > 0 ? pinch.span / now.span : 1);
      cam.pan(now.cx - pinch.cx, now.cy - pinch.cy, canvas.clientHeight);
      let dA = now.angle - pinch.angle;
      if (dA > Math.PI) dA -= 2 * Math.PI;
      if (dA < -Math.PI) dA += 2 * Math.PI;
      if (!cam.state.orbitLock || cam.state.twist) cam.orbit(-dA, 0);   // twist: grab-the-world (locked views only with twist)
      pinch = now;
      if (onChange) onChange();
      return;
    }
    if (!mode || mode === 'pinch') return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    // orbitLock (state flag): 2D/section-locked views — drags PAN instead of
    // orbiting, so a locked plan/section can't be knocked off-plane by a drag
    if (mode === 'orbit') { if (cam.state.orbitLock) cam.pan(dx, dy, canvas.clientHeight); else cam.orbit(-dx * 0.006, dy * 0.006); }
    else if (mode === 'twist') cam.orbit(-dx * 0.006, 0);  // a locked view's map rotation: azimuth only
    else cam.pan(dx, dy, canvas.clientHeight);
    if (onChange) onChange();
  };
  const up = (e) => {
    pts.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    if (pts.size >= 2) { pinch = pinchState(); return; }   // still pinching with others
    if (pts.size === 1) {                                  // pinch → single: re-anchor, no jump
      const rest = [...pts.values()][0];
      mode = 'orbit'; lx = rest.x; ly = rest.y; pinch = null;
      return;
    }
    mode = null; pinch = null;
  };
  const wheel = (e) => { e.preventDefault(); cam.dolly(Math.pow(1.0015, e.deltaY)); if (onChange) onChange(); };
  const ctx = (e) => e.preventDefault();
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', ctx);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('contextmenu', ctx);
  };
}

// ── src/core/gl-blocks.js ──

// @gcu/condenser — box impostors for block models (micro-spec §2.3).
// One screen-aligned quad per block (instanced TRIANGLE_STRIP — no point-sprite
// size cap): the vertex shader expands a camera-basis billboard sized to the
// block's bounding sphere; the fragment shader ray-intersects the block's ACTUAL
// AABB analytically (slab test), discards on miss, writes correct gl_FragDepth
// and the face normal on hit → pixel-perfect cube silhouettes and correct
// inter-block occlusion at one quad per block. Face-normal flat shading; EDL
// does the rest on top.
//
// LOD demotion: a block whose projected radius falls below ~2 px renders as a
// plain circular splat (no ray test) — near field looks like blocks, far field
// looks like the dense cloud it visually is (§2.3).
//
// WebGL2 has no baseInstance, so accumulation slices [first, first+k) work by
// re-pointing the instance attributes at byte offsets before each draw — the
// chunk's VAO records the new pointers (cheap: 3 pointer calls per chunk-draw).
//
// TRUE SECTIONS: the section slab clips the ray-box interval analytically in the
// fragment shader (a couple of dots + interval min/max on top of the existing
// slab test) — a block straddling the plane shows its CUT INTERIOR (flat, plane
// normal, slightly darkened) instead of vanishing or poking through. The vertex
// cull keeps anything TOUCHING the slab (box support radius along the normal);
// demoted splats keep the centroid test (sub-pixel, and a splat can't clip).
//
// Positions are IJK-exact (§2.5): center = uGridOrigin + uGridRot · (aIjk · uGridSize),
// with uGridOrigin the frame-local centroid of block (0,0,0). uGridRot is the
// lattice ROTATION (columns = the unit U/V/W directions; identity for an
// axis-aligned model): one orientation per chunk, so a rotated model draws as
// true oriented boxes — the ray-box test runs in the block's own frame.


const VERT$gl_blocks = `#version 300 es
precision highp float;
layout(location=0) in vec3 aIjk;        // uint16 raw (integer lattice)
layout(location=1) in float aChan;      // uint16 normalized (per-chunk range)
layout(location=2) in float aCat;       // uint8 raw
layout(location=3) in uint aRec;        // uint32 record index (the join key)
layout(location=4) in uvec3 aDimQ;      // u8×3 size in FINE steps (sub-blocked; the block-support contract)
uniform mat4 uViewProj;
uniform vec3 uEye, uRight, uUp;
uniform vec3 uGridOrigin, uGridSize;
uniform mat3 uGridRot;                  // lattice rotation (identity = axis-aligned)
uniform float uSubBlock;                // 1 = variable-size boxes: half = aDimQ · pitch / 2
uniform float uPerspScale;              // persp: px/world at distance 1; ortho: px/world flat
uniform float uOrtho;                   // 1 = orthographic (skip the /dist)
uniform float uDemotePx, uPointPx;
uniform int uColorMode;                 // 0 elevation | 1 grade | 2 category | 3 solid
uniform vec2 uZRange;
uniform vec2 uChanChunk;                // this chunk's [min, span] (dequantize aChan)
uniform vec2 uChanDoc;                  // document [min, span] (ramp normalization)
uniform sampler2D uRamp;
uniform vec4 uNoData;                   // blank values (chan.js code 0 / the value texture's BLANK): rgb + a (a < 0.5 = hidden)
uniform float uNoDataOn;                // off: a blank clamps to the lowest colour, the old picture
uniform sampler2D uPalette;
uniform sampler2D uMask;                // filter bitmask by record index (8192-wide)
uniform float uFilterOn, uIsolate;
uniform float uGhost;                   // the GHOST pass (gl-ghost.js): only the records the filter leaves out
uniform sampler2D uSel;
uniform float uSelOn;
uniform sampler2D uCatVis;              // 256x1 per-class visibility
uniform float uCatVisOn;
uniform sampler2D uRule;                // rule-code byte by record index (8192-wide)
uniform float uRuleOn;                  // rule mode: the code replaces the category
uniform sampler2D uChanTex;             // OPT-IN: raw f32 VALUE by record index (8192-wide rows) —
uniform float uChanTexOn;               // replaces aChan; how a never-materialized grade gets drawn
uniform float uForceSplat;              // 1 = whole chunk demoted (cheap far-field path)
uniform float uFixedSplat;              // 1 = points view: fixed-px splats regardless of block size
uniform uint uPicked;                   // picked RECORD (0xFFFFFFFF = none)
uniform uint uPickedLayer;              // …and the layer it belongs to
uniform uint uLayer;                    // this draw's layer (per-draw, not per-element)                   // record index to highlight (0xFFFFFFFF = none)
uniform uvec2 uRepaint;                 // repaint pass: draw ONLY these two records (both 0xFFFFFFFF = off)
uniform vec4 uSecPlane;                 // section plane: xyz = unit normal, w = offset (frame-local)
uniform vec2 uSecCfg;                   // x: 0 = off, 1 = slab; y: slab half-thickness
#ifdef MIP
uniform float uMipCodes;                // 1 = project the rule CODE (a numeric ƒ / painted column)
#endif
flat out vec3 vCenter;
flat out vec3 vHalf;
flat out vec4 vColor;
flat out float vMode;                   // 0 = impostor, 1 = splat
flat out float vCull;
flat out float vPxR;                    // projected radius (edge-line fade near demotion)
out vec2 vCorner;
out vec3 vWorldPos;
void main() {
  vec3 center = uGridOrigin + uGridRot * (aIjk * uGridSize);
  vec3 half_ = uSubBlock > 0.5 ? vec3(aDimQ) * uGridSize * 0.5 : uGridSize * 0.5;
  float r = length(half_);
  float dist = max(distance(uEye, center), 1e-3);
  float distEff = uOrtho > 0.5 ? 1.0 : dist;              // ortho: size is distance-free
  float pxR = r * uPerspScale / distEff;
  float demoted = max(max(pxR < uDemotePx ? 1.0 : 0.0, uForceSplat), uFixedSplat);
  // filter mask: dim (default) or cull (isolate)
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
  }
  // section cull: keep any box that TOUCHES the slab (support radius of the box
  // along the plane normal) — the fragment shader then clips the ray interval
  // EXACTLY, so straddling blocks show their true cut instead of vanishing.
  // Demoted splats can't clip, so they keep the centroid test (sub-pixel there).
  float secSupp = demoted > 0.5 ? 0.0 : dot(half_, abs(transpose(uGridRot) * uSecPlane.xyz));   // the normal in the box's frame
  float secCull = (uSecCfg.x > 0.5 && abs(dot(center, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y + secSupp * 0.99) ? 1.0 : 0.0;   // 0.99: a box that only TOUCHES the slab (a face on its boundary — the level below a one-block slab) is out, not drawn as a zero-thick face
  vCull = max((uIsolate > 0.5 && m < 0.5) ? 1.0 : 0.0, secCull);
  if (uGhost > 0.5 && m > 0.5) vCull = 1.0;
  float cls = aCat;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  float quadR = uFixedSplat > 0.5
    ? uPointPx * 0.5 * distEff / uPerspScale
    : mix(r, max(uPointPx * 0.5, pxR) * distEff / uPerspScale, demoted);
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 wp = center + (uRight * corner.x + uUp * corner.y) * quadR;
  gl_Position = uViewProj * vec4(wp, 1.0);
  vCenter = center; vHalf = half_; vMode = demoted; vCorner = corner; vWorldPos = wp; vPxR = pxR;
  float mipT = 0.0; bool mipBlank = true;                 // the value a PROJECTION reads (gl-mip.js)
  if (uColorMode == 0) {
    float t = clamp((center.z - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    vColor = texture(uRamp, vec2(t, 0.5));
    if (vColor.a < 0.5) vCull = 1.0;                      // a hidden class: the ramp texel's alpha is 0
  } else if (uColorMode == 1) {
    int cr = int(aRec);
    float v = uChanTexOn > 0.5
      ? texelFetch(uChanTex, ivec2(cr & 8191, cr >> 13), 0).r
      : uChanChunk.x + aChan * uChanChunk.y;
    bool blank = uChanTexOn > 0.5 ? v < -1.0e37 : aChan < 0.5 / 65535.0;
    mipBlank = blank;
    if (blank && uNoDataOn > 0.5) {
      vColor = vec4(uNoData.rgb, 1.0);
      if (uNoData.a < 0.5) vCull = 1.0;
    } else {
      float t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0);
      mipT = t;
      vColor = texture(uRamp, vec2(t, 0.5));
      if (vColor.a < 0.5) vCull = 1.0;
    }
  } else if (uColorMode == 2) {
    vColor = texture(uPalette, vec2((cls + 0.5) / 256.0, 0.5));
  } else {
    vColor = vec4(0.62, 0.63, 0.66, 1.0);
  }
  if (uSelOn > 0.5) {
    int rs = int(aRec);
    if (texelFetch(uSel, ivec2(rs & 8191, rs >> 13), 0).r > 0.5) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.85, 0.3), 0.55), vColor.a);
  }
  if (uFilterOn > 0.5 && m < 0.5) vColor = vec4(vColor.rgb * 0.3, vColor.a);   // context mode: dim non-matching (still legible)
  if (aRec == uPicked && uLayer == uPickedLayer) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.15, 0.7), 0.85) + 0.1, vColor.a);   // picked: hot magenta — the hue viridis doesn't have
  if ((uRepaint.x != 0xFFFFFFFFu || uRepaint.y != 0xFFFFFFFFu) && aRec != uRepaint.x && aRec != uRepaint.y) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // repaint pass: everything else clips out
#ifdef MIP
  // a PROJECTION (gl-mip.js): the record contributes its normalized value — R = t,
  // G = 1 (the mean's count) — or nothing: a blank has no value, and a record the
  // filter leaves out (dim or isolate) is out of the projection. A NUMERIC CODE
  // layer (a ƒ / painted column — codes rise with the value, 0 = blank) projects
  // its code, composited back through its palette
  if (uMipCodes > 0.5) { mipT = cls / 255.0; mipBlank = uColorMode != 2 || cls < 0.5; }
  else if (uColorMode != 1) mipBlank = true;
  if (mipBlank || m < 0.5) vCull = 1.0;
  vColor = vec4(mipT, 1.0, 0.0, 1.0);
#endif
}`;

// 4×4-Bayer screen-door opacity (same as gl-mesh): drops a fraction of pixels by a
// stable dither → "see through" the model WITHOUT alpha blending, so real depth
// writes + occlusion stay correct and no back-to-front sort is needed.
const SCREENDOOR$gl_blocks = `
uniform float uOpacity;
const float _BAYER[16] = float[16](0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0);
bool _screendoor() { if (uOpacity >= 0.999) return false; int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2); return uOpacity < (_BAYER[bi] + 0.5) / 16.0; }`;

const FRAG$gl_blocks = `#version 300 es
precision highp float;
flat in vec3 vCenter;
flat in vec3 vHalf;
flat in vec4 vColor;
flat in float vMode;
flat in float vCull;
flat in float vPxR;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uFwd;                      // view direction (ortho rays are parallel)
uniform float uOrthoRay;                // 1 = ortho: origin per fragment, direction = uFwd
uniform float uBackoff;
uniform mat4 uInvVP;                    // inverse view-projection: a pixel → its ray (exact)
uniform vec4 uVp;                       // the viewport (x, y, w, h); w = 0: the interpolated fallback                 // how far behind the quad the ortho ray starts
uniform vec3 uLightDir;
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform float uEdges;                   // 1 = draw block edge lines (View toggle)
uniform mat3 uGridRot;                  // lattice rotation — the box test runs in its frame
out vec4 outColor;
${SCREENDOOR$gl_blocks}
void main() {
  if (vCull > 0.5) discard;             // isolate mode: filtered-out block
#ifndef MIP
  if (_screendoor()) discard;           // per-layer opacity (screen-door)
#endif
  if (vMode > 0.5) {                    // demoted splat: circular mask, rasterizer depth
    if (dot(vCorner, vCorner) > 1.0) discard;
#ifndef MIP
    gl_FragDepth = gl_FragCoord.z;
#endif
    outColor = vColor;
    return;
  }
  // ray-AABB slab test in frame-local space (perspective: from the eye;
  // orthographic: parallel rays -- origin backed off along the view direction)
  // the ray through THIS pixel, from its own screen position (exact) — not from the interpolated
  // quad position, which the rasterizer only carries to a few cm: a ray on the face between two
  // blocks then missed both (a one-pixel gap down the middle of an odd-width plan)
  vec3 ro, rd;
  if (uVp.z > 0.5) {
    vec2 ndc = ((gl_FragCoord.xy - uVp.xy) / uVp.zw) * 2.0 - 1.0;
    vec4 pa = uInvVP * vec4(ndc, -1.0, 1.0), pb = uInvVP * vec4(ndc, 1.0, 1.0);
    ro = pa.xyz / pa.w; rd = normalize(pb.xyz / pb.w - ro);
  } else {
    ro = uOrthoRay > 0.5 ? vWorldPos - uFwd * uBackoff : uEye;
    rd = uOrthoRay > 0.5 ? uFwd : normalize(vWorldPos - uEye);
  }
  // the box test in the BLOCK's frame (a rotation: t along the ray is unchanged)
  mat3 toBox = transpose(uGridRot);
  vec3 roL = toBox * (ro - vCenter), rdL = toBox * rd;
  // an axis-parallel ray EXACTLY on a box face made (0) * inf = NaN and both neighbours discarded it
  // (a one-pixel gap down the middle of an odd-width plan): keep each direction component finite
  vec3 rdS = vec3(abs(rdL.x) < 1e-12 ? 1e-12 : rdL.x, abs(rdL.y) < 1e-12 ? 1e-12 : rdL.y, abs(rdL.z) < 1e-12 ? 1e-12 : rdL.z);
  vec3 inv = 1.0 / rdS;
  vec3 hB = vHalf * 1.0001;              // a hair of overlap: a ray on the face between two blocks hits one of them, never neither
  vec3 t0 = (-hB - roL) * inv;
  vec3 t1 = (hB - roL) * inv;
  vec3 tmin3 = min(t0, t1), tmax3 = max(t0, t1);
  float tin = max(max(tmin3.x, tmin3.y), tmin3.z);
  float tout = min(min(tmax3.x, tmax3.y), tmax3.z);
  if (tin > tout || tout < 0.0) discard;
  // face normal = the slab that produced the BOX entry (chosen pre-clip), back in world space
  vec3 n = vec3(0.0);
  if (tin == tmin3.x) n = vec3(-sign(rdL.x), 0.0, 0.0);
  else if (tin == tmin3.y) n = vec3(0.0, -sign(rdL.y), 0.0);
  else n = vec3(0.0, 0.0, -sign(rdL.z));
  n = uGridRot * n;
  // TRUE SECTION: intersect the ray-box interval with the ray-slab interval.
  // When the slab plane replaces the box entry, the visible surface is the CUT
  // INTERIOR — flat, plane normal, slightly darkened — so a thin section reads
  // as a continuous painted wall instead of a ragged centroid subset.
  float cutFace = 0.0;
  if (uSecCfg.x > 0.5) {
    float den = dot(rd, uSecPlane.xyz);
    float dc = dot(ro, uSecPlane.xyz) - uSecPlane.w;
    if (abs(den) < 1e-9) { if (abs(dc) > uSecCfg.y) discard; }
    else {
      float ta = (-uSecCfg.y - dc) / den, tb = (uSecCfg.y - dc) / den;
      float sIn = min(ta, tb), sOut = max(ta, tb);
      if (sIn > tin) { tin = sIn; cutFace = -sign(den); }
      tout = min(tout, sOut);
      if (tin > tout || tout < 0.0) discard;
    }
  }
#ifdef MIP
  outColor = vColor;                    // the ray crosses this box (inside the slab): it counts, once per pixel
#else
  float t = tin > 0.0 ? tin : tout;     // inside the box → exit face
  bool onCut = cutFace != 0.0 && t == tin;
  if (onCut) n = uSecPlane.xyz * cutFace;
  vec3 p = ro + rd * t;
  vec4 clip = uViewProj * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  float shade = (0.55 + 0.45 * max(dot(n, uLightDir), 0.0)) * (onCut ? 0.85 : 1.0);
  // BLOCK EDGES (toggle): the hit point in box-local coords — on a face, one
  // axis sits at ±1 and the SECOND-largest → 1 marks an edge; on a cut face
  // (interior) the LARGEST → 1 outlines the cut polygon (block boundaries on
  // the section wall). fwidth gives a ~screen-constant line; fade the effect
  // out as the block shrinks toward demotion so the far field stays clean.
  if (uEdges > 0.5) {
    vec3 a2 = abs(toBox * (p - vCenter)) / vHalf;
    float m1 = max(a2.x, max(a2.y, a2.z));
    float m2 = max(min(a2.x, a2.y), min(max(a2.x, a2.y), a2.z));
    float e = onCut ? m1 : m2;
    float dpx = (1.0 - e) / max(fwidth(e), 1e-6);          // distance to the edge in pixels
    float edge = 1.0 - clamp(dpx * 0.7 - 0.3, 0.0, 1.0);   // ~1.5 px, soft falloff
    edge *= clamp((vPxR - 5.0) / 8.0, 0.0, 1.0);           // fade below ~13 px projected radius
    shade *= 1.0 - 0.4 * edge;
  }
  outColor = vec4(vColor.rgb * shade, vColor.a);
#endif
}`;

// Far-field fragment: splat only, NO gl_FragDepth anywhere → early-z stays
// enabled for these draws — the perf lever for distant chunks (§2.3 mitigation).
const FRAG_CHEAP$gl_blocks = `#version 300 es
precision highp float;
flat in vec3 vCenter;
flat in vec3 vHalf;
flat in vec4 vColor;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uLightDir;
uniform mat4 uViewProj;
out vec4 outColor;
${SCREENDOOR$gl_blocks}
void main() {
  if (vCull > 0.5) discard;
#ifndef MIP
  if (_screendoor()) discard;
#endif
  if (dot(vCorner, vCorner) > 1.0) discard;
  outColor = vColor;
}`;

// Golden-angle hue walk → visually distinct category colors (code → color).
function categoryPalettePixels(n = 256) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const h = (i * 137.508) % 360, s = 0.55, l = 0.58;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    out[i * 4] = Math.round((r + m) * 255); out[i * 4 + 1] = Math.round((g + m) * 255); out[i * 4 + 2] = Math.round((b + m) * 255); out[i * 4 + 3] = 255;
  }
  return out;
}

function createBlocksPipeline(gl) {
  const mkProg = (frag, defs = '') => {
    const prog = makeProgram(gl, withDefines(VERT$gl_blocks, defs), withDefines(frag, defs));
    const U = (n) => gl.getUniformLocation(prog, n);
    return { prog, uni: {
      viewProj: U('uViewProj'), eye: U('uEye'), right: U('uRight'), up: U('uUp'),
      gridOrigin: U('uGridOrigin'), gridSize: U('uGridSize'), gridRot: U('uGridRot'),
      subBlock: U('uSubBlock'), opacity: U('uOpacity'),
      perspScale: U('uPerspScale'), demotePx: U('uDemotePx'), pointPx: U('uPointPx'),
      colorMode: U('uColorMode'), zRange: U('uZRange'), chanChunk: U('uChanChunk'), chanDoc: U('uChanDoc'), noData: U('uNoData'), noDataOn: U('uNoDataOn'),
      ramp: U('uRamp'), palette: U('uPalette'), lightDir: U('uLightDir'),
      mask: U('uMask'), filterOn: U('uFilterOn'), isolate: U('uIsolate'), ghost: U('uGhost'), forceSplat: U('uForceSplat'), fixedSplat: U('uFixedSplat'), picked: U('uPicked'), pickedLayer: U('uPickedLayer'), layer: U('uLayer'), repaint: U('uRepaint'),
      catVis: U('uCatVis'), catVisOn: U('uCatVisOn'), sel: U('uSel'), selOn: U('uSelOn'),
      rule: U('uRule'), ruleOn: U('uRuleOn'),
      chanTex: U('uChanTex'), chanTexOn: U('uChanTexOn'),
      secPlane: U('uSecPlane'), secCfg: U('uSecCfg'), edges: U('uEdges'),
      ortho: U('uOrtho'), fwd: U('uFwd'), orthoRay: U('uOrthoRay'), backoff: U('uBackoff'), invVP: U('uInvVP'), vp: U('uVp'),
      mipCodes: U('uMipCodes'),
    } };
  };
  // the program SETS: the raster, and (built on first use, so a scene that never
  // projects never compiles them) the projection's — same geometry, same culling,
  // the fragment writes the value instead of a lit colour (gl-mip.js)
  const normal = { full: mkProg(FRAG$gl_blocks), cheap: mkProg(FRAG_CHEAP$gl_blocks) };
  let mip = null;
  let set = normal;
  let active = normal.full;

  // Upload one BlockChunk → buffers + a VAO whose instance pointers get re-aimed
  // per slice. CPU arrays are free to die after this returns.
  function upload(chunk) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mkBuf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const bIjk = mkBuf(chunk.ijk), bChan = mkBuf(chunk.chan), bCat = mkBuf(chunk.cat);
    const bRec = mkBuf(chunk.recIdx);                      // filter-mask lookup + pick pass
    const sub = !!chunk.dimQ;
    const bDim = sub ? mkBuf(chunk.dimQ) : null;           // per-block u8×3 size in fine steps (3 B/block)
    gl.bindVertexArray(null);
    return {
      kind: 'blocks', vao, buffers: sub ? [bIjk, bChan, bCat, bRec, bDim] : [bIjk, bChan, bCat, bRec],
      bIjk, bChan, bCat, bRec, bDim, sub, dimQMax: sub ? chunk.dimQMax || [255, 255, 255] : null,
      count: chunk.count, bboxLocal: chunk.bboxLocal, cursor: 0,
      grid: chunk.grid, chanRange: chunk.chanRange,
    };
  }

  // Aim the instance attributes at element `first` and draw k instances.
  // useCheap: the whole chunk projects below the demotion threshold, so the
  // no-gl_FragDepth program (early-z enabled) draws it as forced splats.
  function drawSlice(c, first, k, useCheap = false) {
    const pp = useCheap ? set.cheap : set.full;
    if (pp !== active) { gl.useProgram(pp.prog); active = pp; }
    const uni = active.uni;
    gl.uniform1f(uni.forceSplat, useCheap ? 1 : 0);
    gl.bindVertexArray(c.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bIjk);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, 0, first * 6);
    gl.vertexAttribDivisor(0, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bChan);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, true, 0, first * 2);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, first);
    gl.vertexAttribDivisor(2, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, 0, first * 4);
    gl.vertexAttribDivisor(3, 1);
    if (c.sub) {                                            // sub-blocked: per-block size in fine steps
      gl.bindBuffer(gl.ARRAY_BUFFER, c.bDim);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribIPointer(4, 3, gl.UNSIGNED_BYTE, 3, first * 3);
      gl.vertexAttribDivisor(4, 1);
      gl.uniform1f(uni.subBlock, 1);
    } else {
      gl.disableVertexAttribArray(4);
      // A disabled `in uvec3 aDimQ` reads the generic current value, which defaults to
      // FLOAT — a type mismatch vs the uint declaration (GL_INVALID_OPERATION at draw).
      // Give it a valid uint default; aDimQ is unused when uSubBlock=0, so 0 is a no-op.
      gl.vertexAttribI4ui(4, 0, 0, 0, 0);
      gl.uniform1f(uni.subBlock, 0);
    }
    gl.uniform3f(uni.gridOrigin, c.grid.originLocal[0], c.grid.originLocal[1], c.grid.originLocal[2]);
    gl.uniform3f(uni.gridSize, c.grid.size[0], c.grid.size[1], c.grid.size[2]);
    gl.uniformMatrix3fv(uni.gridRot, false, c.grid.rot || IDENTITY3);
    const dq = chanDequant(c.chanRange);
    gl.uniform2f(uni.chanChunk, dq[0], dq[1]);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
  }

  // Per-frame program state (called once before the chunk loop) — set on BOTH
  // programs so drawSlice can switch freely between full and cheap.
  function begin(cam, { pointPx, colorMode, zRange, chanDoc, ramp, palette, viewportH, maskTex = null, isolate = false, pointsView = false, picked = 0xFFFFFFFF, pickedLayer = 0xFFFFFFFF, layer = 0, section = null, catVisTex = null, selTex = null, ruleTex = null, chanTex = null, opacity = 1, edges = false, noData = null, projection = false, mipCodes = false, ghost = false }) {
    const s = cam.state;
    if (projection && !mip) mip = { full: mkProg(FRAG$gl_blocks, '#define MIP 1'), cheap: mkProg(FRAG_CHEAP$gl_blocks, '#define MIP 1') };
    set = projection ? mip : normal;
    for (const pp of [set.full, set.cheap]) {
      gl.useProgram(pp.prog);
      const uni = pp.uni;
      gl.uniformMatrix4fv(uni.viewProj, false, s.viewProj);
      { const inv = mat4Inverse(s.viewProj), vp = gl.getParameter(gl.VIEWPORT); if (inv) { gl.uniformMatrix4fv(uni.invVP, false, inv); gl.uniform4f(uni.vp, vp[0], vp[1], vp[2], vp[3]); } else gl.uniform4f(uni.vp, 0, 0, 0, 0); }
      gl.uniform3f(uni.eye, s.eye[0], s.eye[1], s.eye[2]);
      const v = s.view;                                    // camera basis = view-matrix rotation rows
      gl.uniform3f(uni.right, v[0], v[4], v[8]);
      gl.uniform3f(uni.up, v[1], v[5], v[9]);
      // headlight, slightly above the view direction
      let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
      const ll = Math.hypot(lx, ly, lz) || 1;
      lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
      const l2 = Math.hypot(lx, ly, lz) || 1;
      gl.uniform3f(uni.lightDir, lx / l2, ly / l2, lz / l2);
      gl.uniform1f(uni.perspScale, s.ortho ? (viewportH / 2) / s.halfH : (viewportH / 2) / Math.tan(s.fovY / 2));
      gl.uniform1f(uni.ortho, s.ortho ? 1 : 0);
      gl.uniform1f(uni.orthoRay, s.ortho ? 1 : 0);
      {
        const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
        const fl = Math.hypot(...f) || 1;
        gl.uniform3f(uni.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
        gl.uniform1f(uni.backoff, s.radius * 2);
      }
      gl.uniform1f(uni.demotePx, 2.0);
      gl.uniform1f(uni.pointPx, pointPx * backingRatio(gl.canvas));
      gl.uniform1i(uni.colorMode, colorMode);
      gl.uniform2f(uni.zRange, zRange[0], zRange[1]);
      gl.uniform2f(uni.chanDoc, chanDoc[0], chanDoc[1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ramp); gl.uniform1i(uni.ramp, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, palette); gl.uniform1i(uni.palette, 1);
      gl.uniform1f(uni.subBlock, 0);
      gl.uniform1f(uni.opacity, Math.max(0.02, Math.min(1, opacity)));   // per-layer screen-door opacity
      gl.uniform1f(uni.fixedSplat, pointsView ? 1 : 0);
      gl.uniform1ui(uni.picked, picked >>> 0);
      gl.uniform1ui(uni.pickedLayer, pickedLayer >>> 0);
      gl.uniform1ui(uni.layer, layer >>> 0);              // this draw's layer — the id no longer hides in aRec
      gl.uniform2ui(uni.repaint, 0xFFFFFFFF, 0xFFFFFFFF);
      gl.uniform4f(uni.secPlane, section ? section.n[0] : 0, section ? section.n[1] : 0, section ? section.n[2] : 1, section ? section.d : 0);
      gl.uniform2f(uni.secCfg, section ? 1 : 0, section ? section.half : 0);
      gl.uniform1f(uni.edges, edges ? 1 : 0);
      if (uni.mipCodes) gl.uniform1f(uni.mipCodes, mipCodes ? 1 : 0);
      gl.uniform1f(uni.filterOn, maskTex ? 1 : 0);
      gl.uniform1f(uni.isolate, isolate && !ghost ? 1 : 0);
      gl.uniform1f(uni.ghost, ghost ? 1 : 0);
      if (maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(uni.mask, 4); }
      gl.uniform1f(uni.catVisOn, catVisTex ? 1 : 0);
      if (catVisTex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, catVisTex); gl.uniform1i(uni.catVis, 5); }
      gl.uniform1f(uni.selOn, selTex ? 1 : 0);
      if (selTex) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, selTex); gl.uniform1i(uni.sel, 6); }
      gl.uniform1f(uni.ruleOn, ruleTex ? 1 : 0);
      if (ruleTex) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, ruleTex); gl.uniform1i(uni.rule, 7); }
      gl.uniform1f(uni.chanTexOn, chanTex ? 1 : 0);
      gl.uniform1f(uni.noDataOn, noData ? 1 : 0);
      if (noData) gl.uniform4f(uni.noData, noData[0], noData[1], noData[2], noData[3]);
      if (chanTex) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, chanTex); gl.uniform1i(uni.chanTex, 8); }
    }
    active = set.full;
    gl.useProgram(set.full.prog);
  }

  // The pick-repaint pass (gl.js): both programs get the target pair, then the
  // lazily-tracked active program is restored so drawSlice's cache stays honest.
  function setRepaint(a, b) {
    for (const pp of [set.full, set.cheap]) { gl.useProgram(pp.prog); gl.uniform2ui(pp.uni.repaint, a >>> 0, b >>> 0); }
    if (active) gl.useProgram(active.prog);
  }

  return { upload, drawSlice, begin, setRepaint };
}

// ── src/core/section.js ──

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

function offsetSection(sec, o) {
  if (!sec || !o) return sec;
  const k = sec.n[0] * o[0] + sec.n[1] * o[1] + sec.n[2] * o[2];
  return sec.d0 !== undefined ? { ...sec, d: sec.d - k, d0: sec.d0 - k } : { ...sec, d: sec.d - k };
}

function layerSection(sec, mode = true, offset = null) {
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
function meshSection(sec, mode = true, offset = null) {
  const s2 = layerSection(sec, mode, offset);
  if (!s2 || !(s2.clip === 'front' || s2.clip === 'behind') || s2.d0 === undefined) return s2;
  return { ...s2, d: s2.d0, half: Math.max(0.01, s2.traceHalf || 1) };
}

// ── src/core/gl-pick.js ──

// @gcu/condenser — GPU ID-buffer picking. On click, the visible chunks re-render
// once into an offscreen target with the fragment shaders outputting the RECORD
// INDEX encoded as RGBA8 instead of a color, scissored to the cursor pixel; one
// readPixels + decode gives the exact element under the cursor. The SAME analytic
// geometry that renders decides the pick — the impostor's ray-AABB test and real
// depth writes resolve which block face is hit, pixel-perfect at any zoom. No CPU
// spatial index. The record index is THE join key (micro-spec §4): a pick is a
// row number in the source file.


// no encoder: the pick target is RG32UI (R = record, G = layer + face), so the
// ids go out as integers instead of being smeared across four bytes and
// reassembled. The layer needs 6 bits and has 32, so the FACE of the hit rides
// in the spare ones — the fragment shader already solved the ray-box entry to
// write true depth, and throwing that away meant the CPU had to re-derive it
// (a second ray-AABB + sub-block dims + slab clip, drifting from what was drawn).
//
//   G = (layer & 0xFFFF) | (face << 16)
//   face: 0=−X 1=+X 2=−Y 3=+Y 4=−Z 5=+Z, 6 = the SECTION CUT wall, 7 = none
//
// Naming the face names the PLANE, so the exact hit point is ray ∩ plane — one
// line on the CPU, and it agrees with the pixel by construction.
const ENCODE = '';
const PACK = `
const uint NO_FACE = 7u;
uint packId(uint layer, uint face) { return (layer & 0xFFFFu) | (face << 16); }`;

// ── points ──
const PICK_VERT_PTS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in float aIntensity;   // the visual VAO's, unchanged
layout(location=2) in float aClass;
layout(location=4) in uint aRec;
uniform mat4 uViewProj;
uniform vec3 uBoxMin, uBoxSpan;
uniform float uPointPx;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform sampler2D uMask;
uniform float uFilterOn, uIsolate;
uniform sampler2D uCatVis;
uniform float uCatVisOn;
uniform float uValCullOn;               // the layer hides by VALUE — a class's eye, or blanks (gl.js _valPick)
uniform int uColorMode;
uniform vec2 uZRange, uChanChunk, uChanDoc;
uniform float uChanTexOn, uNoDataOn, uIntensityScale;
uniform vec4 uNoData;
uniform sampler2D uChanTex, uRamp;
uniform sampler2D uRule;
uniform float uRuleOn;
flat out uint vRec;
flat out float vCull;
#ifdef MIP
uniform int uMipMode;                   // 0 max · 1 min · 2 mean (gl-mip.js)
uniform float uMipRef;                  // the pixel's mean (mode 2)
uniform float uMipCodes;                // 1 = the layer projects its rule CODE (a numeric ƒ / painted column)
flat out float vKey;                    // the depth the pick sorts by: the record that IS the pixel's value wins
flat out float vMipT;                   // the record's projected value (a region pick keys a mean per pixel)
#endif
void main() {
  vec3 p = uBoxMin + aPos * uBoxSpan;
  gl_Position = uViewProj * vec4(p, 1.0);
  gl_PointSize = uPointPx;
  vRec = aRec;
  vCull = (uSecCfg.x > 0.5 && abs(dot(p, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y) ? 1.0 : 0.0;
  if (uFilterOn > 0.5 && uIsolate > 0.5) {
    int rec = int(aRec);
    if (texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r < 0.5) vCull = 1.0;   // isolated-away isn't pickable
  }
  float cls = aClass;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  if (uValCullOn > 0.5) {                 // hidden by value isn't pickable: the visual pass's test, exactly
    float t = -1.0; bool blank = false;
    if (uColorMode == 0) t = clamp((p.z - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    else if (uColorMode == 1) {
      if (uChanTexOn > 0.5) { int rc = int(aRec); float v = texelFetch(uChanTex, ivec2(rc & 8191, rc >> 13), 0).r; blank = v < -1.0e37; t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0); }
      else { t = clamp(aIntensity * uIntensityScale, 0.0, 1.0); }
    }
    if (blank && uNoDataOn > 0.5) { if (uNoData.a < 0.5) vCull = 1.0; }
    else if (t >= 0.0 && texture(uRamp, vec2(t, 0.5)).a < 0.5) vCull = 1.0;
  }
#ifdef MIP
  {                                       // the projection's own contribution rule (gl.js VERT, MIP)
    float t; bool blank = false;
    if (uChanTexOn > 0.5) { int rc = int(aRec); float v = texelFetch(uChanTex, ivec2(rc & 8191, rc >> 13), 0).r; blank = v < -1.0e37; t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0); }
    else t = clamp(aIntensity * uIntensityScale, 0.0, 1.0);
    if (uFilterOn > 0.5) { int rm = int(aRec); if (texelFetch(uMask, ivec2(rm & 8191, rm >> 13), 0).r < 0.5) vCull = 1.0; }
    if (uMipCodes > 0.5) { t = cls / 255.0; blank = uColorMode != 2 || cls < 0.5; }
    else if (uColorMode != 1) blank = true;
    if (blank) vCull = 1.0;
    vMipT = t;
    vKey = 0.5 * (uMipMode == 0 ? 1.0 - t : (uMipMode == 1 ? t : abs(t - uMipRef)));
  }
#endif
}`;
const PICK_FRAG_PTS = `#version 300 es
precision highp float;
flat in uint vRec;
flat in float vCull;
#ifdef MIP
flat in float vKey;
flat in float vMipT;
uniform sampler2D uMipAcc;              // a MEAN projection's own target: the pixel's mean, per pixel (a region pick)
uniform float uMipAccOn;
float mipKey() {
  if (uMipAccOn < 0.5) return vKey;
  vec4 a = texelFetch(uMipAcc, ivec2(gl_FragCoord.xy), 0);
  return 0.5 * abs(vMipT - (a.g > 0.5 ? a.r / a.g : 0.0));
}
#endif
uniform uint uLayer;                    // the layer is per-DRAW, not per-element
out uvec4 outId;                        // R = record (full uint32), G = layer | face<<16
${PACK}
void main() {
  if (vCull > 0.5) discard;
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
#ifdef MIP
  gl_FragDepth = mipKey();
#endif
  outId = uvec4(vRec, packId(uLayer, NO_FACE), 0u, 0u);   // a splat has no face
}`;

// ── blocks (geometry identical to gl-blocks; color replaced by the encoded id) ──
const PICK_VERT_BLK = `#version 300 es
precision highp float;
layout(location=0) in vec3 aIjk;
layout(location=1) in float aChan;       // the visual VAO's, unchanged
layout(location=2) in float aCat;
layout(location=3) in uint aRec;
layout(location=4) in uvec3 aDimQ;      // u8×3 size in fine steps (sub-blocked)
uniform mat4 uViewProj;
uniform vec3 uEye, uRight, uUp;
uniform vec3 uGridOrigin, uGridSize;
uniform mat3 uGridRot;
uniform float uSubBlock;
uniform float uPerspScale, uDemotePx, uPointPx, uFixedSplat, uOrtho;
uniform sampler2D uMask;
uniform float uFilterOn, uIsolate;
uniform sampler2D uCatVis;
uniform float uCatVisOn;
uniform float uValCullOn;               // the layer hides by VALUE — a class's eye, or blanks (gl.js _valPick)
uniform int uColorMode;
uniform vec2 uZRange, uChanChunk, uChanDoc;
uniform float uChanTexOn, uNoDataOn, uIntensityScale;
uniform vec4 uNoData;
uniform sampler2D uChanTex, uRamp;
uniform sampler2D uRule;
uniform float uRuleOn;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
flat out vec3 vCenter;
flat out vec3 vHalf;
flat out uint vRec;
flat out float vMode;
flat out float vCull;
out vec2 vCorner;
out vec3 vWorldPos;
#ifdef MIP
uniform int uMipMode;                   // 0 max · 1 min · 2 mean (gl-mip.js)
uniform float uMipRef;                  // the pixel's mean (mode 2)
uniform float uMipCodes;                // 1 = the layer projects its rule CODE (a numeric ƒ / painted column)
flat out float vKey;                    // the depth the pick sorts by: the record that IS the pixel's value wins
flat out float vMipT;                   // the record's projected value (a region pick keys a mean per pixel)
#endif
void main() {
  vec3 center = uGridOrigin + uGridRot * (aIjk * uGridSize);
  vec3 half_ = uSubBlock > 0.5 ? vec3(aDimQ) * uGridSize * 0.5 : uGridSize * 0.5;
  float r = length(half_);
  float dist = max(distance(uEye, center), 1e-3);
  float distEff = uOrtho > 0.5 ? 1.0 : dist;
  float pxR = r * uPerspScale / distEff;
  float demoted = max(pxR < uDemotePx ? 1.0 : 0.0, uFixedSplat);
  float quadR = uFixedSplat > 0.5
    ? uPointPx * 0.5 * distEff / uPerspScale
    : mix(r, max(uPointPx * 0.5, pxR) * distEff / uPerspScale, demoted);
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 wp = center + (uRight * corner.x + uUp * corner.y) * quadR;
  gl_Position = uViewProj * vec4(wp, 1.0);
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
  }
  // touch-the-slab cull (support radius) — the fragment clips exactly, matching
  // the visual true-section cut so the cut wall is pickable
  float secSupp = demoted > 0.5 ? 0.0 : dot(half_, abs(transpose(uGridRot) * uSecPlane.xyz));
  float secCull = (uSecCfg.x > 0.5 && abs(dot(center, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y + secSupp * 0.99) ? 1.0 : 0.0;   // 0.99: a box that only TOUCHES the slab (a face on its boundary — the level below a one-block slab) is out, not drawn as a zero-thick face
  vCull = max((uIsolate > 0.5 && m < 0.5) ? 1.0 : 0.0, secCull);   // hidden (isolated or sectioned) isn't pickable
  float cls = aCat;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  if (uValCullOn > 0.5) {                 // hidden by value isn't pickable: the visual pass's test, exactly
    float t = -1.0; bool blank = false;
    if (uColorMode == 0) t = clamp((center.z - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    else if (uColorMode == 1) {
      if (uChanTexOn > 0.5) { int rc = int(aRec); float v = texelFetch(uChanTex, ivec2(rc & 8191, rc >> 13), 0).r; blank = v < -1.0e37; t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0); }
      else { float v = uChanChunk.x + aChan * uChanChunk.y; blank = aChan < 0.5 / 65535.0; t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0); }
    }
    if (blank && uNoDataOn > 0.5) { if (uNoData.a < 0.5) vCull = 1.0; }
    else if (t >= 0.0 && texture(uRamp, vec2(t, 0.5)).a < 0.5) vCull = 1.0;
  }
#ifdef MIP
  {                                       // the projection's own contribution rule (gl-blocks VERT, MIP)
    float t; bool blank;
    if (uChanTexOn > 0.5) { int rc = int(aRec); float v = texelFetch(uChanTex, ivec2(rc & 8191, rc >> 13), 0).r; blank = v < -1.0e37; t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0); }
    else { float v = uChanChunk.x + aChan * uChanChunk.y; blank = aChan < 0.5 / 65535.0; t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0); }
    if (uMipCodes > 0.5) { t = cls / 255.0; blank = uColorMode != 2 || cls < 0.5; }
    else if (uColorMode != 1) blank = true;
    if (blank || m < 0.5) vCull = 1.0;
    vMipT = t;
    vKey = 0.5 * (uMipMode == 0 ? 1.0 - t : (uMipMode == 1 ? t : abs(t - uMipRef)));
  }
#endif
  vCenter = center; vHalf = half_; vRec = aRec; vMode = demoted; vCorner = corner; vWorldPos = wp;
}`;
const PICK_FRAG_BLK = `#version 300 es
precision highp float;
flat in vec3 vCenter;
flat in vec3 vHalf;
flat in uint vRec;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
#ifdef MIP
flat in float vKey;
flat in float vMipT;
uniform sampler2D uMipAcc;              // a MEAN projection's own target: the pixel's mean, per pixel (a region pick)
uniform float uMipAccOn;
float mipKey() {
  if (uMipAccOn < 0.5) return vKey;
  vec4 a = texelFetch(uMipAcc, ivec2(gl_FragCoord.xy), 0);
  return 0.5 * abs(vMipT - (a.g > 0.5 ? a.r / a.g : 0.0));
}
#endif
uniform vec3 uEye;
uniform vec3 uFwd;
uniform float uOrthoRay;
uniform float uBackoff;
uniform mat4 uInvVP;                    // inverse view-projection: a pixel → its ray (exact)
uniform vec4 uVp;                       // the viewport (x, y, w, h); w = 0: the interpolated fallback
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform uint uLayer;
uniform mat3 uGridRot;
out uvec4 outId;
${PACK}
void main() {
  if (vCull > 0.5) discard;
  if (vMode > 0.5) {
    if (dot(vCorner, vCorner) > 1.0) discard;
    gl_FragDepth = gl_FragCoord.z;
#ifdef MIP
    gl_FragDepth = mipKey();
#endif
    outId = uvec4(vRec, packId(uLayer, NO_FACE), 0u, 0u);  // demoted to a splat: no box, no face
    return;
  }
  // the ray through THIS pixel, from its own screen position (exact) — not from the interpolated
  // quad position, which the rasterizer only carries to a few cm: a ray on the face between two
  // blocks then missed both (a one-pixel gap down the middle of an odd-width plan)
  vec3 ro, rd;
  if (uVp.z > 0.5) {
    vec2 ndc = ((gl_FragCoord.xy - uVp.xy) / uVp.zw) * 2.0 - 1.0;
    vec4 pa = uInvVP * vec4(ndc, -1.0, 1.0), pb = uInvVP * vec4(ndc, 1.0, 1.0);
    ro = pa.xyz / pa.w; rd = normalize(pb.xyz / pb.w - ro);
  } else {
    ro = uOrthoRay > 0.5 ? vWorldPos - uFwd * uBackoff : uEye;
    rd = uOrthoRay > 0.5 ? uFwd : normalize(vWorldPos - uEye);
  }
  // the box test in the block's frame (as gl-blocks): a rotated model's FACE
  // ids name its LATTICE faces (U/V/W ±), not world ones
  mat3 toBox = transpose(uGridRot);
  vec3 roL = toBox * (ro - vCenter), rdL = toBox * rd;
  // an axis-parallel ray EXACTLY on a box face made (0) * inf = NaN and both neighbours discarded it
  // (a one-pixel gap down the middle of an odd-width plan): keep each direction component finite
  vec3 rdS = vec3(abs(rdL.x) < 1e-12 ? 1e-12 : rdL.x, abs(rdL.y) < 1e-12 ? 1e-12 : rdL.y, abs(rdL.z) < 1e-12 ? 1e-12 : rdL.z);
  vec3 inv = 1.0 / rdS;
  vec3 hB = vHalf * 1.0001;              // a hair of overlap: a ray on the face between two blocks hits one of them, never neither
  vec3 t0 = (-hB - roL) * inv;
  vec3 t1 = (hB - roL) * inv;
  vec3 tmin3 = min(t0, t1), tmax3 = max(t0, t1);
  float tin = max(max(tmin3.x, tmin3.y), tmin3.z);
  float tout = min(min(tmax3.x, tmax3.y), tmax3.z);
  if (tin > tout || tout < 0.0) discard;
  float tinBox = tin;                                    // the box entry, before any slab clip
  // clip by the section slab — the visible CUT surface is what picks (gl-blocks)
  if (uSecCfg.x > 0.5) {
    float den = dot(rd, uSecPlane.xyz);
    float dc = dot(ro, uSecPlane.xyz) - uSecPlane.w;
    if (abs(den) < 1e-9) { if (abs(dc) > uSecCfg.y) discard; }
    else {
      float ta = (-uSecCfg.y - dc) / den, tb = (uSecCfg.y - dc) / den;
      tin = max(tin, min(ta, tb));
      tout = min(tout, max(ta, tb));
      if (tin > tout || tout < 0.0) discard;
    }
  }
  float t = tin > 0.0 ? tin : tout;
  vec4 clip = uViewProj * vec4(ro + rd * t, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
#ifdef MIP
  gl_FragDepth = mipKey();                                 // a projection: sort by value, not distance
#endif
  // WHICH FACE the eye ray entered through: the axis that WON the box entry,
  // signed by the ray's direction along it (travelling +x → you hit the −X face).
  // If the slab clip pushed the entry past the box's own, you are looking at the
  // CUT, not a face. tin ≤ 0 means the eye is inside the block — no face.
  uint face = NO_FACE;
  if (tin > 0.0) {
    if (tin > tinBox + 1e-5) face = 6u;                  // the section cut wall
    else {
      uint ax = (tmin3.x >= tmin3.y && tmin3.x >= tmin3.z) ? 0u : ((tmin3.y >= tmin3.z) ? 1u : 2u);
      float rda = ax == 0u ? rdL.x : (ax == 1u ? rdL.y : rdL.z);
      face = ax * 2u + (rda > 0.0 ? 0u : 1u);
    }
  }
  outId = uvec4(vRec, packId(uLayer, face), 0u, 0u);
}`;

// ── sticks (capsule geometry identical to gl-sticks; color = the encoded id) ──
const PICK_VERT_STK = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA;
layout(location=1) in vec3 aB;
layout(location=2) in float aChan;       // the visual VAO's, unchanged
layout(location=3) in float aCat;
layout(location=4) in uint aRec;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uRadius, uPerspScale, uDemotePx, uPointPx, uFixedSplat, uOrtho;
uniform vec3 uFwd;
uniform sampler2D uMask;
uniform float uFilterOn, uIsolate;
uniform sampler2D uCatVis;
uniform float uCatVisOn;
uniform float uValCullOn;               // the layer hides by VALUE — a class's eye, or blanks (gl.js _valPick)
uniform int uColorMode;
uniform vec2 uZRange, uChanChunk, uChanDoc;
uniform float uChanTexOn, uNoDataOn, uIntensityScale;
uniform vec4 uNoData;
uniform sampler2D uChanTex, uRamp;
uniform sampler2D uRule;
uniform float uRuleOn;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
flat out vec3 vA;
flat out vec3 vB;
flat out uint vRec;
flat out float vMode;
flat out float vCull;
out vec2 vCorner;
out vec3 vWorldPos;
void main() {
  vec3 center = (aA + aB) * 0.5;
  vec3 axis = aB - aA;
  float len = max(length(axis), 1e-6);
  vec3 u = axis / len;
  float dist = max(distance(uEye, center), 1e-3);
  float distEff = uOrtho > 0.5 ? 1.0 : dist;
  vec3 viewDir = uOrtho > 0.5 ? uFwd : (center - uEye) / dist;
  vec3 v = cross(u, viewDir);
  float vl = length(v);
  v = vl > 1e-4 ? v / vl : normalize(abs(u.z) < 0.9 ? cross(u, vec3(0.0, 0.0, 1.0)) : cross(u, vec3(1.0, 0.0, 0.0)));
  float pxR = (len * 0.5 + uRadius) * uPerspScale / distEff;
  float demoted = max(pxR < uDemotePx ? 1.0 : 0.0, uFixedSplat);
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
  }
  float secSupp = demoted > 0.5 ? 0.0 : (abs(dot(axis, uSecPlane.xyz)) * 0.5 + uRadius);
  float secCull = (uSecCfg.x > 0.5 && abs(dot(center, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y + secSupp * 0.99) ? 1.0 : 0.0;   // 0.99: a box that only TOUCHES the slab (a face on its boundary — the level below a one-block slab) is out, not drawn as a zero-thick face
  vCull = max((uIsolate > 0.5 && m < 0.5) ? 1.0 : 0.0, secCull);
  float cls = aCat;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  if (uValCullOn > 0.5) {                 // hidden by value isn't pickable: the visual pass's test, exactly
    float t = -1.0; bool blank = false;
    if (uColorMode == 0) t = clamp((center.z - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    else if (uColorMode == 1) {
      if (uChanTexOn > 0.5) { int rc = int(aRec); float v = texelFetch(uChanTex, ivec2(rc & 8191, rc >> 13), 0).r; blank = v < -1.0e37; t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0); }
      else { float v = uChanChunk.x + aChan * uChanChunk.y; blank = aChan < 0.5 / 65535.0; t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0); }
    }
    if (blank && uNoDataOn > 0.5) { if (uNoData.a < 0.5) vCull = 1.0; }
    else if (t >= 0.0 && texture(uRamp, vec2(t, 0.5)).a < 0.5) vCull = 1.0;
  }
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 wp;
  if (demoted > 0.5) {
    float quadR = max(uPointPx * 0.5, min(pxR, uPointPx * 2.0)) * distEff / uPerspScale;
    vec3 sv = normalize(cross(viewDir, v));
    wp = center + (v * corner.x + sv * corner.y) * quadR;
  } else {
    wp = center + u * (corner.x * (len * 0.5 + uRadius)) + v * (corner.y * uRadius);
  }
  gl_Position = uViewProj * vec4(wp, 1.0);
  vA = aA; vB = aB; vRec = aRec; vMode = demoted; vCorner = corner; vWorldPos = wp;
}`;
const PICK_FRAG_STK = `#version 300 es
precision highp float;
flat in vec3 vA;
flat in vec3 vB;
flat in uint vRec;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uFwd;
uniform float uOrthoRay;
uniform float uBackoff;
uniform float uRadius;
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform uint uLayer;
out uvec4 outId;
${PACK}
void main() {
  if (vCull > 0.5) discard;
  if (vMode > 0.5) {
    if (dot(vCorner, vCorner) > 1.0) discard;
    gl_FragDepth = gl_FragCoord.z;
    outId = uvec4(vRec, packId(uLayer, NO_FACE), 0u, 0u);
    return;
  }
  vec3 ro = uOrthoRay > 0.5 ? vWorldPos - uFwd * uBackoff : uEye;
  vec3 rd = uOrthoRay > 0.5 ? uFwd : normalize(vWorldPos - uEye);
  vec3 ba = vB - vA;
  vec3 oa = ro - vA;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa);
  float rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard;
  float b = baba * rdoa - baoa * bard;
  float c = baba * oaoa - baoa * baoa - uRadius * uRadius * baba;
  float h = b * b - a * c;
  float t = -1.0;
  if (h >= 0.0) {
    float tb = (-b - sqrt(h)) / max(a, 1e-9);
    float y = baoa + tb * bard;
    if (y > 0.0 && y < baba && tb > 0.0) t = tb;
  }
  if (t < 0.0) {
    for (int i = 0; i < 2; i++) {
      vec3 capC = i == 0 ? vA : vB;
      vec3 o2 = ro - capC;
      float b2 = dot(rd, o2);
      float c2 = dot(o2, o2) - uRadius * uRadius;
      float h2 = b2 * b2 - c2;
      if (h2 >= 0.0) {
        float t2 = -b2 - sqrt(h2);
        if (t2 > 0.0 && (t < 0.0 || t2 < t)) t = t2;
      }
    }
  }
  if (t < 0.0) discard;
  // section clip (convexity trick, matches gl-sticks): a hit outside the slab is
  // either the cut cross-section at the face or not pickable at all
  if (uSecCfg.x > 0.5) {
    float den = dot(rd, uSecPlane.xyz);
    float dc = dot(ro, uSecPlane.xyz) - uSecPlane.w;
    if (abs(dc + t * den) > uSecCfg.y) {
      if (abs(den) < 1e-9) discard;
      float sIn = min((-uSecCfg.y - dc) / den, (uSecCfg.y - dc) / den);
      if (sIn <= t) discard;
      vec3 q = ro + rd * sIn;
      vec3 qa = q - vA;
      float yq = clamp(dot(qa, ba) / baba, 0.0, 1.0);
      if (length(qa - ba * yq) > uRadius) discard;
      t = sIn;
    }
  }
  vec4 clip = uViewProj * vec4(ro + rd * t, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  outId = uvec4(vRec, packId(uLayer, NO_FACE), 0u, 0u);   // a capsule has no axis-aligned face
}`;

const NO_LAYER = 0xFFFFFFFF;                                // the layer channel's miss sentinel

// The G channel's contract, in ONE place. Anything that reads the pick buffer —
// pick(), pickRegion()'s callers, a rubber-band sweep — unpacks through these.
const layerOfId = (g) => (g >>> 0) & 0xFFFF;
const faceOfId = (g) => ((g >>> 16) & 7);
const isMiss = (g) => (g >>> 0) === NO_LAYER;
const NO_FACE = 7;
const FACE_CUT = 6;
// unit normals per face code, and the human name. index 6/7 have no normal.
const FACE_NORMALS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], null, null];
const FACE_NAMES = ['−X (west)', '+X (east)', '−Y (south)', '+Y (north)', '−Z (bottom)', '+Z (top)', 'section cut', '—'];
const MISS_CLEAR = new Uint32Array([0xFFFFFFFF, 0xFFFFFFFF, 0, 0]);

// ── meshes ──
// A mesh has NO per-row records: it is a bag of triangles, not rows of a table.
// So the ID buffer answers only WHICH mesh (record = 0), and the CPU raycasts
// that mesh's BVH for the triangle + the exact point (winding's raycastBVH).
// WebGL2 has no gl_PrimitiveID, and un-indexing a mesh purely to carry a
// per-vertex triangle id would triple its vertex memory — for a click.
//
// The geometry and the SECTION behavior mirror gl-mesh exactly (including the
// trace-over-the-wall depth flatten): you must pick what you see, or the ID
// buffer is lying.
const PICK_VERT_MSH = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
out vec3 vWorldPos;
out float vSecDist;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vWorldPos = aPos;
  vSecDist = dot(aPos, uSecPlane.xyz) - uSecPlane.w;
}`;
const PICK_FRAG_MSH = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in float vSecDist;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform mat4 uViewProj;
uniform vec3 uEye, uFwd;
uniform float uOrtho;
uniform uint uLayer;
out uvec4 outId;
${PACK}
void main() {
  if (uSecCfg.x > 0.5 && abs(vSecDist) > uSecCfg.y) discard;
  gl_FragDepth = gl_FragCoord.z;
  if (uSecCfg.x > 0.5) {                                   // the visual flattens the in-slab trace onto the
    float dcEye = dot(uEye, uSecPlane.xyz) - uSecPlane.w;  // camera-side wall; the pick must agree or you
    if (abs(dcEye) > uSecCfg.y) {                          // would see a trace you cannot click
      float side = sign(dcEye);
      vec3 q; bool front = false;
      if (uOrtho > 0.5) {
        float den = dot(uFwd, uSecPlane.xyz);
        if (abs(den) > 1e-9) {
          float t = (vSecDist - side * uSecCfg.y) / den;
          if (t > 0.0) { q = vWorldPos - uFwd * t; front = true; }
        }
      } else {
        vec3 rdm = vWorldPos - uEye;
        float den = dot(rdm, uSecPlane.xyz);
        if (abs(den) > 1e-9) {
          float tF = (side * uSecCfg.y - dcEye) / den;
          if (tF > 0.0 && tF < 1.0) { q = uEye + rdm * tF; front = true; }
        }
      }
      if (front) {
        vec4 clipQ = uViewProj * vec4(q, 1.0);
        gl_FragDepth = clamp(clipQ.z / clipQ.w * 0.5 + 0.5, 0.0, 1.0) - 3e-5;
      }
    }
  }
  outId = uvec4(0u, packId(uLayer, NO_FACE), 0u, 0u);      // record 0: the CPU resolves the triangle
}`;

function createPickPipeline(gl) {
  const msh = makeProgram(gl, PICK_VERT_MSH, PICK_FRAG_MSH);
  const uMsh = {
    viewProj: gl.getUniformLocation(msh, 'uViewProj'), secPlane: gl.getUniformLocation(msh, 'uSecPlane'),
    secCfg: gl.getUniformLocation(msh, 'uSecCfg'), eye: gl.getUniformLocation(msh, 'uEye'),
    fwd: gl.getUniformLocation(msh, 'uFwd'), ortho: gl.getUniformLocation(msh, 'uOrtho'),
    layer: gl.getUniformLocation(msh, 'uLayer'),
  };
  const stk = makeProgram(gl, PICK_VERT_STK, PICK_FRAG_STK);
  const U = (p, n) => gl.getUniformLocation(p, n);
  // the points + blocks programs, as a SET: the plain pick, and (built on first use)
  // the projection's — same geometry and gates, depth = the value key (gl-mip.js)
  const mkSet = (defs) => {
  const pts = makeProgram(gl, withDefines(PICK_VERT_PTS, defs), withDefines(PICK_FRAG_PTS, defs));
  const blk = makeProgram(gl, withDefines(PICK_VERT_BLK, defs), withDefines(PICK_FRAG_BLK, defs));
  const uPts = { layer: U(pts, 'uLayer'), viewProj: U(pts, 'uViewProj'), boxMin: U(pts, 'uBoxMin'), boxSpan: U(pts, 'uBoxSpan'), pointPx: U(pts, 'uPointPx'), secPlane: U(pts, 'uSecPlane'), secCfg: U(pts, 'uSecCfg'), mask: U(pts, 'uMask'), filterOn: U(pts, 'uFilterOn'), isolate: U(pts, 'uIsolate'), catVis: U(pts, 'uCatVis'), catVisOn: U(pts, 'uCatVisOn'), rule: U(pts, 'uRule'), ruleOn: U(pts, 'uRuleOn'), valCullOn: U(pts, 'uValCullOn'), colorMode: U(pts, 'uColorMode'), zRange: U(pts, 'uZRange'), chanChunk: U(pts, 'uChanChunk'), chanDoc: U(pts, 'uChanDoc'), chanTexOn: U(pts, 'uChanTexOn'), noDataOn: U(pts, 'uNoDataOn'), intensityScale: U(pts, 'uIntensityScale'), noData: U(pts, 'uNoData'), chanTex: U(pts, 'uChanTex'), ramp: U(pts, 'uRamp') };
  const uBlk = {
    layer: U(blk, 'uLayer'),
    viewProj: U(blk, 'uViewProj'), invVP: U(blk, 'uInvVP'), vp: U(blk, 'uVp'), eye: U(blk, 'uEye'), right: U(blk, 'uRight'), up: U(blk, 'uUp'),
    gridOrigin: U(blk, 'uGridOrigin'), gridSize: U(blk, 'uGridSize'), gridRot: U(blk, 'uGridRot'),
    subBlock: U(blk, 'uSubBlock'),
    perspScale: U(blk, 'uPerspScale'), demotePx: U(blk, 'uDemotePx'), pointPx: U(blk, 'uPointPx'), fixedSplat: U(blk, 'uFixedSplat'),
    ortho: U(blk, 'uOrtho'), fwd: U(blk, 'uFwd'), orthoRay: U(blk, 'uOrthoRay'), backoff: U(blk, 'uBackoff'),
    mask: U(blk, 'uMask'), filterOn: U(blk, 'uFilterOn'), isolate: U(blk, 'uIsolate'),
    catVis: U(blk, 'uCatVis'), catVisOn: U(blk, 'uCatVisOn'), rule: U(blk, 'uRule'), ruleOn: U(blk, 'uRuleOn'),
    valCullOn: U(blk, 'uValCullOn'), colorMode: U(blk, 'uColorMode'), zRange: U(blk, 'uZRange'), chanChunk: U(blk, 'uChanChunk'), chanDoc: U(blk, 'uChanDoc'), chanTexOn: U(blk, 'uChanTexOn'), noDataOn: U(blk, 'uNoDataOn'), intensityScale: U(blk, 'uIntensityScale'), noData: U(blk, 'uNoData'), chanTex: U(blk, 'uChanTex'), ramp: U(blk, 'uRamp'),
    secPlane: U(blk, 'uSecPlane'), secCfg: U(blk, 'uSecCfg'),
  };
  for (const [p, u] of [[pts, uPts], [blk, uBlk]]) { u.mipMode = U(p, 'uMipMode'); u.mipRef = U(p, 'uMipRef'); u.mipCodes = U(p, 'uMipCodes'); u.mipAcc = U(p, 'uMipAcc'); u.mipAccOn = U(p, 'uMipAccOn'); }
  return { pts, blk, uPts, uBlk };
  };
  const plainSet = mkSet('');
  let mipSet = null;
  const uStk = {
    layer: U(stk, 'uLayer'),
    viewProj: U(stk, 'uViewProj'), eye: U(stk, 'uEye'), radius: U(stk, 'uRadius'),
    perspScale: U(stk, 'uPerspScale'), demotePx: U(stk, 'uDemotePx'), pointPx: U(stk, 'uPointPx'), fixedSplat: U(stk, 'uFixedSplat'),
    ortho: U(stk, 'uOrtho'), fwd: U(stk, 'uFwd'), orthoRay: U(stk, 'uOrthoRay'), backoff: U(stk, 'uBackoff'),
    mask: U(stk, 'uMask'), filterOn: U(stk, 'uFilterOn'), isolate: U(stk, 'uIsolate'),
    catVis: U(stk, 'uCatVis'), catVisOn: U(stk, 'uCatVisOn'), rule: U(stk, 'uRule'), ruleOn: U(stk, 'uRuleOn'),
    valCullOn: U(stk, 'uValCullOn'), colorMode: U(stk, 'uColorMode'), zRange: U(stk, 'uZRange'), chanChunk: U(stk, 'uChanChunk'), chanDoc: U(stk, 'uChanDoc'), chanTexOn: U(stk, 'uChanTexOn'), noDataOn: U(stk, 'uNoDataOn'), intensityScale: U(stk, 'uIntensityScale'), noData: U(stk, 'uNoData'), chanTex: U(stk, 'uChanTex'), ramp: U(stk, 'uRamp'),
    secPlane: U(stk, 'uSecPlane'), secCfg: U(stk, 'uSecCfg'),
  };
  let fbo = null, colorTex = null, depthTex = null, w = 0, h = 0;

  function ensure(width, height) {
    if (fbo && width === w && height === h) return;
    w = width; h = height;
    if (fbo) { gl.deleteFramebuffer(fbo); gl.deleteTexture(colorTex); gl.deleteTexture(depthTex); }
    colorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    // RG32UI: R = record (a full uint32), G = layer. Integer target → the ids are
    // read back as integers, with no byte packing anywhere.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, w, h, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // depth is a TEXTURE (not a renderbuffer): the deferred re-shade resolve
    // samples it to unproject each pixel's exact hit point (block edge lines)
    depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Pick at device pixel (px, py) (GL origin, bottom-left). Draws each chunk's
   * CURRENT accumulated prefix (you pick what you can see), scissored to the
   * pixel. Returns the record index, or null.
   */
  // the shared ID-buffer pass: scissored to (px,py,w,h), leaves the FBO bound
  // for the caller's readPixels. pick() reads 1px; pickRegion() reads the block.
  function renderInto(px, py, w2, h2, chunks, cam, { pointPx, blocksAsPoints = false, layerStates = null, section = null, viewportW, viewportH, noClear = false, mip = null }) {
    if (mip && !mipSet) mipSet = mkSet('#define MIP 1');
    const { pts, blk, uPts, uBlk } = mip ? mipSet : plainSet;
    // a projection pick (gl-mip.js): the value uniforms the key needs, whether or not the layer hides by value
    const MIP_MODE = { max: 0, min: 1, mean: 2 };
    const setMip = (u, st, id) => {
      if (!mip) return;
      const vp = st && st._valPick;
      gl.uniform1i(u.mipMode, MIP_MODE[mip.mode] || 0);
      gl.uniform1f(u.mipRef, mip.ref || 0);
      gl.uniform1f(u.mipCodes, st && st.projCodes && st.ruleOn && st.ruleTex ? 1 : 0);
      // a region pick of a MEAN: each pixel's own mean, read from the projection's target
      const acc = mip.refTex && mip.refTex(id);
      gl.uniform1f(u.mipAccOn, acc ? 1 : 0);
      if (acc) { gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, acc); gl.uniform1i(u.mipAcc, 10); }
      gl.uniform1i(u.colorMode, vp ? vp.colorMode : 1);
      if (vp) { gl.uniform2f(u.chanDoc, vp.chanDoc[0], vp.chanDoc[1]); gl.uniform1f(u.intensityScale, vp.intensityScale); }
      gl.uniform1f(u.chanTexOn, st && st.chanTex ? 1 : 0);
      if (st && st.chanTex) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, st.chanTex); gl.uniform1i(u.chanTex, 8); }
    };
    const stateOf = (id) => (layerStates && layerStates.get(id)) || { maskTex: null, isolate: false };
    const byLayer = (arr) => {
      const m = new Map();
      for (const c of arr) { const id = c._layer || 0; let g = m.get(id); if (!g) m.set(id, g = []); g.push(c); }
      return m;
    };
    // the layer's view of the section — section.js, the SAME function the draw
    // uses (it was a hand-kept mirror here; a pick must agree with the picture)
    // ...and drawn with its own camera: the offset folded in as a translation
    const stateFor = (st) => (st && st.offset ? translateState(cam.state, st.offset) : cam.state);
    const setSecWith = (u, s) => {
      gl.uniform4f(u.secPlane, s ? s.n[0] : 0, s ? s.n[1] : 0, s ? s.n[2] : 1, s ? s.d : 0);
      gl.uniform2f(u.secCfg, s ? 1 : 0, s ? s.half : 0);
    };
    const setSec = (u, st) => setSecWith(u, layerSection(section, st ? st.sectioned : true, st && st.offset));
    const setSecMesh = (u, st) => setSecWith(u, meshSection(section, st ? st.sectioned : true, st && st.offset));
    // hidden classes aren't pickable (same texture the visual pass culls by)
    const setCatVis = (u, st) => {
      const t = st && st.catVisTex;
      gl.uniform1f(u.catVisOn, t ? 1 : 0);
      if (t) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u.catVis, 5); }
    };
    // rule mode: the code substitutes for the class, so hidden RULES cull too
    const setRule = (u, st) => {
      const t = st && st.ruleOn && st.ruleTex;
      gl.uniform1f(u.ruleOn, t ? 1 : 0);
      if (t) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u.rule, 7); }
    };
    // hidden by VALUE isn't pickable: a class's eye (ramp texel alpha 0) or hidden blanks. Only a
    // layer that hides something pays for the test; the rest skip it (uValCullOn 0)
    const setVal = (u, st) => {
      const vp = st && st._valPick;
      const on = !!(vp && (vp.colorMode === 0 || vp.colorMode === 1) && ((st.rampHides && st.rampTex) || (st.noData && st.noData[3] < 0.5)));
      gl.uniform1f(u.valCullOn, on ? 1 : 0);
      if (!on) return;
      gl.uniform1i(u.colorMode, vp.colorMode);
      gl.uniform2f(u.zRange, vp.zRange[0], vp.zRange[1]);
      gl.uniform2f(u.chanDoc, vp.chanDoc[0], vp.chanDoc[1]);
      gl.uniform1f(u.intensityScale, vp.intensityScale);
      gl.uniform1f(u.chanTexOn, st.chanTex ? 1 : 0);
      if (st.chanTex) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, st.chanTex); gl.uniform1i(u.chanTex, 8); }
      gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, st.rampTex || null); gl.uniform1i(u.ramp, 9);
      gl.uniform1f(u.noDataOn, st.noData ? 1 : 0);
      if (st.noData) gl.uniform4f(u.noData, st.noData[0], st.noData[1], st.noData[2], st.noData[3]);
    };
    ensure(viewportW, viewportH);
    // the FBO's colour attachment is ALSO the id capture the resolve pass
    // samples (captureViewport hands out colorTex itself), and that pass
    // leaves it bound on unit 0 — exactly where every sampler this program
    // never sets defaults to. Render into it while it is bound on a sampled
    // unit and WebGL drops the draw as a feedback loop (INVALID_OPERATION):
    // every pick after a re-shade is a miss until something else rebinds unit
    // 0. Unbind the units these programs touch before drawing; a pick must
    // not depend on the ambient texture state.
    for (const u of [0, 2, 4, 5, 7]) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(px, py, w2, h2);
    if (!noClear) {                                        // (a progressive capture's later batches draw over the earlier ones)
      gl.clearBufferuiv(gl.COLOR, 0, MISS_CLEAR);          // layer = NO_LAYER → "nothing here"
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    gl.enable(gl.DEPTH_TEST);
    const s = cam.state;
    const dpp = pointPx * backingRatio(gl.canvas);
    // A chunk writes only inside its bbox's screen footprint (+ a splat's
    // radius), so a scissored pick draws just the chunks over the region. A
    // one-pixel pick on a 60M-block model ran the vertex stage for every block
    // (~0.5 s, the page waiting on readPixels); Morton chunks are tight, so the
    // few under the cursor are all it needs. A box that crosses the eye plane
    // can't be projected — it's drawn, conservatively. The full-viewport capture
    // draws everything.
    const whole = px <= 0 && py <= 0 && px + w2 >= viewportW && py + h2 >= viewportH;
    let maxScale = 1;                                      // a layer's glyph size widens what can cover the region
    if (layerStates) for (const st of layerStates.values ? layerStates.values() : []) if (st && st.pointScale > maxScale) maxScale = st.pointScale;
    const margin = dpp * maxScale + 2;
    const covers = (c) => {
      const b = c.bboxLocal;
      if (whole || !b || !(b[0] <= b[3])) return true;
      const m = stateFor(stateOf(c._layer || 0)).viewProj;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < 8; k++) {
        const x = b[k & 1 ? 3 : 0], y = b[k & 2 ? 4 : 1], z = b[k & 4 ? 5 : 2];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (!(cw > 1e-9)) return true;
        const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * viewportW;
        const sy = ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5 + 0.5) * viewportH;
        if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
      }
      return !(x1 < px - margin || x0 > px + w2 + margin || y1 < py - margin || y0 > py + h2 + margin);
    };

    const ptsChunks = chunks.filter((c) => c.kind === 'points' && c.cursor > 0 && covers(c));
    if (ptsChunks.length) {
      gl.useProgram(pts);
      gl.uniformMatrix4fv(uPts.viewProj, false, s.viewProj);
      gl.uniform1f(uPts.pointPx, dpp);
      for (const [id, group] of byLayer(ptsChunks)) {
      const st = stateOf(id);
      gl.uniformMatrix4fv(uPts.viewProj, false, stateFor(st).viewProj);
      gl.uniform1ui(uPts.layer, id >>> 0);
      gl.uniform1f(uPts.pointPx, dpp * ((st && st.pointScale) || 1));
      setSec(uPts, st);
      setCatVis(uPts, st);
      setRule(uPts, st);
      setVal(uPts, st);
      setMip(uPts, st, id);
      gl.uniform1f(uPts.filterOn, st.maskTex ? 1 : 0);
      gl.uniform1f(uPts.isolate, st.isolate ? 1 : 0);
      if (st.maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, st.maskTex); gl.uniform1i(uPts.mask, 4); }
      for (const c of group) {
        gl.bindVertexArray(c.vao);
        // wire the recIdx buffer as attr 4 (idempotent; the visual program ignores it)
        gl.bindBuffer(gl.ARRAY_BUFFER, c.buffers[c.buffers.length - 1]);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, 0);
        gl.uniform3f(uPts.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
        gl.uniform3f(uPts.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
        gl.drawArrays(gl.POINTS, 0, c.cursor);
      }
      }
    }

    const blkChunks = chunks.filter((c) => c.kind === 'blocks' && c.cursor > 0 && covers(c));
    if (blkChunks.length) {
      gl.useProgram(blk);
      // the camera uniforms, per layer (a moved layer has its own)
      const setBlkCam = (s) => {
        gl.uniformMatrix4fv(uBlk.viewProj, false, s.viewProj);
        { const inv = mat4Inverse(s.viewProj), vp = gl.getParameter(gl.VIEWPORT); if (inv) { gl.uniformMatrix4fv(uBlk.invVP, false, inv); gl.uniform4f(uBlk.vp, vp[0], vp[1], vp[2], vp[3]); } else gl.uniform4f(uBlk.vp, 0, 0, 0, 0); }
        gl.uniform3f(uBlk.eye, s.eye[0], s.eye[1], s.eye[2]);
        const v = s.view;
        gl.uniform3f(uBlk.right, v[0], v[4], v[8]);
        gl.uniform3f(uBlk.up, v[1], v[5], v[9]);
        gl.uniform1f(uBlk.perspScale, s.ortho ? (viewportH / 2) / s.halfH : (viewportH / 2) / Math.tan(s.fovY / 2));
        gl.uniform1f(uBlk.ortho, s.ortho ? 1 : 0);
        gl.uniform1f(uBlk.orthoRay, s.ortho ? 1 : 0);
        const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
        const fl = Math.hypot(...f) || 1;
        gl.uniform3f(uBlk.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
        gl.uniform1f(uBlk.backoff, s.radius * 2);
      };
      gl.uniform1f(uBlk.demotePx, 2.0);
      gl.uniform1f(uBlk.pointPx, dpp);
      gl.uniform1f(uBlk.fixedSplat, blocksAsPoints ? 1 : 0);
      for (const [id, group] of byLayer(blkChunks)) {
        gl.uniform1ui(uBlk.layer, id >>> 0);
      const st = stateOf(id);
      setBlkCam(stateFor(st));
      setSec(uBlk, st);
      setCatVis(uBlk, st);
      setRule(uBlk, st);
      setVal(uBlk, st);
      setMip(uBlk, st, id);
      gl.uniform1f(uBlk.filterOn, st.maskTex ? 1 : 0);
      gl.uniform1f(uBlk.isolate, st.isolate ? 1 : 0);
      if (st.maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, st.maskTex); gl.uniform1i(uBlk.mask, 4); }
      for (const c of group) {
        gl.bindVertexArray(c.vao);
        { const dq = chanDequant(c.chanRange || [0, 0]); gl.uniform2f(uBlk.chanChunk, dq[0], dq[1]); }
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bIjk);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, 0, 0);
        gl.vertexAttribDivisor(0, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.vertexAttribDivisor(2, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, 0, 0);
        gl.vertexAttribDivisor(3, 1);
        if (c.sub) {
          gl.bindBuffer(gl.ARRAY_BUFFER, c.bDim);
          gl.enableVertexAttribArray(4);
          gl.vertexAttribIPointer(4, 3, gl.UNSIGNED_BYTE, 3, 0);
          gl.vertexAttribDivisor(4, 1);
          gl.uniform1f(uBlk.subBlock, 1);
        } else {
          gl.disableVertexAttribArray(4);
          gl.vertexAttribI4ui(4, 0, 0, 0, 0);   // uint default for the disabled `in uvec3 aDimQ` (see gl-blocks.js)
          gl.uniform1f(uBlk.subBlock, 0);
        }
        gl.uniform3f(uBlk.gridOrigin, c.grid.originLocal[0], c.grid.originLocal[1], c.grid.originLocal[2]);
        gl.uniform3f(uBlk.gridSize, c.grid.size[0], c.grid.size[1], c.grid.size[2]);
        gl.uniformMatrix3fv(uBlk.gridRot, false, c.grid.rot || IDENTITY3);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.cursor);
      }
      }
    }

    const stkChunks = chunks.filter((c) => c.kind === 'sticks' && c.cursor > 0);
    if (stkChunks.length) {
      gl.useProgram(stk);
      const setStkCam = (s) => {
        gl.uniformMatrix4fv(uStk.viewProj, false, s.viewProj);
        gl.uniform3f(uStk.eye, s.eye[0], s.eye[1], s.eye[2]);
        gl.uniform1f(uStk.perspScale, s.ortho ? (viewportH / 2) / s.halfH : (viewportH / 2) / Math.tan(s.fovY / 2));
        gl.uniform1f(uStk.ortho, s.ortho ? 1 : 0);
        gl.uniform1f(uStk.orthoRay, s.ortho ? 1 : 0);
        const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
        const fl = Math.hypot(...f) || 1;
        gl.uniform3f(uStk.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
        gl.uniform1f(uStk.backoff, s.radius * 2);
      };
      gl.uniform1f(uStk.demotePx, 2.0);
      gl.uniform1f(uStk.pointPx, dpp);
      gl.uniform1f(uStk.fixedSplat, blocksAsPoints ? 1 : 0);
      for (const [id, group] of byLayer(stkChunks)) {
        gl.uniform1ui(uStk.layer, id >>> 0);
      const st2 = stateOf(id);
      setStkCam(stateFor(st2));
      setSec(uStk, st2);
      setCatVis(uStk, st2);
      setRule(uStk, st2);
      setVal(uStk, st2);
      gl.uniform1f(uStk.radius, (st2 && st2.stickRadius) || 1);
      gl.uniform1f(uStk.filterOn, st2.maskTex ? 1 : 0);
      gl.uniform1f(uStk.isolate, st2.isolate ? 1 : 0);
      if (st2.maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, st2.maskTex); gl.uniform1i(uStk.mask, 4); }
      for (const c of group) {
        gl.bindVertexArray(c.vao);
        { const dq = chanDequant(c.chanRange || [0, 0]); gl.uniform2f(uStk.chanChunk, dq[0], dq[1]); }
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bSeg);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        gl.vertexAttribDivisor(1, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.vertexAttribDivisor(3, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, 0);
        gl.vertexAttribDivisor(4, 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.cursor);
      }
      }
    }

    // ── meshes: WHICH mesh, not which triangle (the CPU's job) ──
    // Policy lives with the app: a layer may declare itself pickable. The default
    // is OPAQUE-ONLY, and that is deliberate — you make a context surface
    // see-through precisely so you can work on what is behind it, so a 50%
    // topography must not steal the click meant for the block under it.
    const mshChunks = chunks.filter((c) => c.kind === 'mesh' && c.idxCount > 0);
    if (mshChunks.length) {
      gl.useProgram(msh);
      for (const [id, group] of byLayer(mshChunks)) {
        const st = stateOf(id);
        const pickable = st.meshPickable != null ? st.meshPickable : (st.meshOpacity == null || st.meshOpacity >= 0.95);
        if (!pickable) continue;
        const ms = stateFor(st);
        gl.uniformMatrix4fv(uMsh.viewProj, false, ms.viewProj);
        gl.uniform3f(uMsh.eye, ms.eye[0], ms.eye[1], ms.eye[2]);
        const f = [ms.target[0] - ms.eye[0], ms.target[1] - ms.eye[1], ms.target[2] - ms.eye[2]];
        const fl = Math.hypot(...f) || 1;
        gl.uniform3f(uMsh.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
        gl.uniform1f(uMsh.ortho, ms.ortho ? 1 : 0);
        gl.uniform1ui(uMsh.layer, id >>> 0);
        setSecMesh(uMsh, st);                              // the TRACE band, exactly as gl.js's meshSecOf draws it
        for (const c of group) {
          gl.bindVertexArray(c.vao);
          gl.drawElements(gl.TRIANGLES, c.idxCount, gl.UNSIGNED_INT, 0);
        }
      }
    }

    gl.disable(gl.SCISSOR_TEST);
  }

  // → { layer, rec } or null. Both come straight out of the integer target: no
  // byte reassembly, and the RECORD may use the full 32-bit range because the
  // miss sentinel now lives in the LAYER channel.
  function pick(px, py, chunks, cam, opts) {
    renderInto(px, py, 1, 1, chunks, cam, opts);
    const out = new Uint32Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    if (out[1] === NO_LAYER) return null;
    const g = out[1] >>> 0;
    return { layer: g & 0xFFFF, rec: out[0] >>> 0, face: (g >>> 16) & 7 };
  }

  // one ID-buffer pass over a RECT (device px, GL bottom-left origin) — the
  // marquee/lasso read. Same programs, same per-layer gates; returns the raw
  // RGBA block (rows bottom-up); the caller masks by polygon and decodes.
  // the marquee/lasso read: a Uint32Array of 4 components per pixel (rows
  // bottom-up) — [0] = record, [1] = layer | face<<16 (NO_LAYER = nothing there;
  // unpack with layerOfId/faceOfId, never by reading [1] raw)
  function pickRegion(px, py, w2, h2, chunks, cam, opts) {
    renderInto(px, py, w2, h2, chunks, cam, opts);
    const out = new Uint32Array(w2 * h2 * 4);
    gl.readPixels(px, py, w2, h2, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return out;
  }

  // deferred re-shade (gl-resolve.js): render the FULL-VIEWPORT id buffer and
  // hand back the target texture itself — NO readPixels; the resolve pass
  // samples it on the GPU. The texture stays owned by this pipeline; later
  // pick()/pickRegion() calls repaint scissored regions of it with the same
  // camera + geometry, so within one capture generation (camera and structure
  // frozen — the caller invalidates on any moving frame) the content stays
  // consistent. Leaves FBO at null; the caller restores its own target.
  function captureViewport(chunks, cam, opts) {
    renderInto(0, 0, opts.viewportW, opts.viewportH, chunks, cam, opts);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return { tex: colorTex, depth: depthTex, w, h };
  }

  // the same capture, PROGRESSIVE: beginCapture clears the whole target, each
  // captureMore draws one batch of chunks over it (depth-tested against what's
  // there), so the full id buffer of a still frame is built across idle frames
  // instead of in one long pass. Same result as captureViewport.
  function beginCapture(viewportW, viewportH) {
    ensure(viewportW, viewportH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearBufferuiv(gl.COLOR, 0, MISS_CLEAR);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function captureMore(chunks, cam, opts) {
    renderInto(0, 0, opts.viewportW, opts.viewportH, chunks, cam, { ...opts, noClear: true });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return { tex: colorTex, depth: depthTex, w, h };
  }
  // a rect of the CAPTURED buffer (no render) — what pickRegion returns
  function readCaptured(px, py, w2, h2) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const out = new Uint32Array(w2 * h2 * 4);
    gl.readPixels(px, py, w2, h2, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  return { pick, pickRegion, captureViewport, beginCapture, captureMore, readCaptured, NO_LAYER };
}

// ── src/core/gl-mip.js ──

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


const PROJECTION_MODES = ['max', 'min', 'mean'];

const QUAD_VERT$gl_mip = `#version 300 es
precision highp float;
void main() {                          // fullscreen triangle, no buffers
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// decode: 0 = float max (hit: R ≥ 0) · 1 = float min (hit: R ≤ 1) · 2 = 8-bit (hit: A) · 3 = mean (R / G)
const COMPOSITE_FRAG$gl_mip = `#version 300 es
precision highp float;
uniform sampler2D uAcc;
uniform sampler2D uRamp;
uniform int uDecode;
uniform float uCodes;                   // > 0: t is a CODE / 255 — sample the palette (uCodes = its width) at the code
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
  t = clamp(t, 0.0, 1.0);
  vec2 uv = uCodes > 0.5 ? vec2((t * 255.0 + 0.5) / uCodes, 0.5) : vec2(t, 0.5);
  outColor = vec4(texture(uRamp, uv).rgb, 1.0);
}`;

/** The JS side of the decode — one place, shared by the readbacks. → t in 0..1, or null (nothing hit). */
function decodeProjection(decode, r, g, a) {
  if (decode === 0) return r >= 0 ? r : null;
  if (decode === 1) return r <= 1 ? r : null;
  if (decode === 2) return a > 0.5 ? r : null;
  return g > 0.5 ? r / g : null;
}

function createMipPipeline(gl) {
  const cbf = !!gl.getExtension('EXT_color_buffer_float');
  const floatBlend = !!gl.getExtension('EXT_float_blend');
  const comp = makeProgram(gl, QUAD_VERT$gl_mip, COMPOSITE_FRAG$gl_mip);
  const uAcc = gl.getUniformLocation(comp, 'uAcc'), uRamp = gl.getUniformLocation(comp, 'uRamp'), uDecode = gl.getUniformLocation(comp, 'uDecode'), uCodes = gl.getUniformLocation(comp, 'uCodes');
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
  // codes: the target holds CODE / 255 — `ramp` is then the layer's palette, `width` wide
  function composite(layer, ramp, { codes = false, width = 256 } = {}) {
    const t = targets.get(layer);
    if (!t) return;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(comp);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(uAcc, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ramp); gl.uniform1i(uRamp, 3);
    gl.uniform1i(uDecode, decodeOf(t.mode, t.fmt));
    gl.uniform1f(uCodes, codes ? width : 0);
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
  // the accumulated target itself (texture + how to decode it): a region pick reads a mean
  // projection's per-pixel value from it (gl-pick.js uMipAcc)
  function target(layer) { const t = targets.get(layer); return t ? { tex: t.tex, decode: decodeOf(t.mode, t.fmt), w: t.w, h: t.h, mode: t.mode } : null; }
  return {
    begin, end, composite, read, drop, target,
    clear() { for (const id of [...targets.keys()]) drop(id); },
    has: (layer) => targets.has(layer),
    // what this GPU offers: per mode, the target format (null = not offered)
    support() { const o = {}; for (const m of PROJECTION_MODES) { const f = formatFor(m); o[m] = f ? { format: f.key, bits: f.bits, float: f.float } : null; } return o; },
    supports: (mode) => !!formatFor(mode),
  };
}

// ── src/core/gl-ghost.js ──

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


const GHOST_STYLES = ['tint', 'outline'];

const QUAD_VERT$gl_ghost = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMPOSITE_FRAG$gl_ghost = `#version 300 es
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

function createGhostPipeline(gl) {
  const comp = makeProgram(gl, QUAD_VERT$gl_ghost, COMPOSITE_FRAG$gl_ghost);
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

// ── src/core/gl-logs.js ──

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


const LOG_KINDS = ['bar', 'strip'];

const VERT$gl_logs = `#version 300 es
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

const FRAG$gl_logs = `#version 300 es
precision highp float;
flat in vec4 vColor;
flat in float vCull;
out vec4 outColor;
void main() {
  if (vCull > 0.5) discard;
  outColor = vColor;
}`;

const W = 8192;

function createLogsPipeline(gl) {
  const prog = makeProgram(gl, VERT$gl_logs, FRAG$gl_logs);
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

// ── src/core/gl-resolve.js ──

// @gcu/condenser — DEFERRED RE-SHADE (render-paths spec §2). Once the scene
// has converged, the pick pipeline's full-viewport (record, layer|face) id
// buffer is kept as a texture, and COSMETIC changes — ramp, clip, color
// mode, filter (dim), selection, chanTex values — run ONE fullscreen resolve
// pass per element layer instead of re-rasterizing the geometry. O(pixels)
// at any model size: a ramp drag over a 50M-block model recolors at refresh
// rate instead of restarting the accumulation.
//
// Two GPU pieces, no CPU data needed:
//   bake    — per layer, scatter each element's (z, value, category, rgb) to
//             its RECORD's texel in an 8192-wide RGBA32F attribute texture
//             (one point-draw over the layer's chunks; works for streamed
//             models whose columns were never CPU-resident).
//   resolve — fullscreen triangle per layer: id → attr texel → the SAME
//             color math the raster shaders use (parity by construction,
//             including the raster shaders' per-kind wash order), written
//             into the EDL color buffer; `discard` leaves background /
//             mesh / other-layer pixels untouched, and the untouched EDL
//             depth still shades the presented frame.
//
// Blocks' per-face impostor lighting reconstructs from the id buffer's FACE
// code (gl-pick names the plane the eye ray entered): shade = (0.55 +
// 0.45·max(n·L,0)) · (cut ? 0.85 : 1) — the exact gl-blocks formula. Splat-
// demoted pixels (NO_FACE) stay unlit, exactly as rasterized. Out of scope
// (the caller falls back to re-raster): block EDGE lines (need the intra-face
// hit position), opacity < 1 (screen-door), catVis / isolate (they CULL
// geometry, so the id buffer itself goes stale), sticks / soup layers.


const TEXW = 8192;

// ── bake shaders: element → its record's texel ──────────────────────────────
const BAKE_VERT_BLOCKS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aIjk;
layout(location=1) in float aChan;
layout(location=2) in float aCat;
layout(location=3) in uint aRec;
uniform vec3 uGridOrigin, uGridSize;
uniform mat3 uGridRot;                   // lattice rotation (identity = axis-aligned)
uniform vec2 uChanChunk;                 // this chunk's [min, span] (dequantize aChan)
uniform vec2 uTexSize;
flat out vec4 vAttr;
void main() {
  int rec = int(aRec);
  vec2 px = vec2(float(rec & 8191) + 0.5, float(rec >> 13) + 0.5);
  gl_Position = vec4(px / uTexSize * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  float z = (uGridOrigin + uGridRot * (aIjk * uGridSize)).z;
  vAttr = vec4(z, uChanChunk.x + aChan * uChanChunk.y, aCat, aChan < 0.5 / 65535.0 ? 1.0 : 0.0);   // w: a BLANK (chan.js)
}`;

const BAKE_VERT_POINTS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in float aIntensity;
layout(location=2) in float aClass;
layout(location=3) in vec3 aRgb;
layout(location=4) in uint aRec;
uniform vec3 uBoxMin, uBoxSpan;
uniform vec2 uTexSize;
flat out vec4 vAttr;
void main() {
  int rec = int(aRec);
  vec2 px = vec2(float(rec & 8191) + 0.5, float(rec >> 13) + 0.5);
  gl_Position = vec4(px / uTexSize * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  float z = uBoxMin.z + aPos.z * uBoxSpan.z;
  // rgb packs into one float exactly (24 bits fit f32's 24-bit mantissa)
  float rgb = floor(aRgb.r * 255.0 + 0.5) + floor(aRgb.g * 255.0 + 0.5) * 256.0 + floor(aRgb.b * 255.0 + 0.5) * 65536.0;
  vAttr = vec4(z, aIntensity, aClass, rgb);
}`;

const BAKE_FRAG = `#version 300 es
precision highp float;
flat in vec4 vAttr;
out vec4 outAttr;
void main() { outAttr = vAttr; }`;

// ── the resolve pass: id → attrs → the raster shaders' color math ──────────
const RESOLVE_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const RESOLVE_FRAG = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D uId;                  // RG32UI: R = record, G = layer | face<<16 (NO_LAYER = miss)
uniform sampler2D uAttr;                 // baked (z, value, cat, rgbPacked) by record
uniform sampler2D uRamp, uPalette, uMask, uSel, uRule, uChanTex;
uniform sampler2D uDepth;                // the capture's hit depths (edge-line unproject)
uniform uint uLayerId, uPicked, uPickedLayer;
uniform int uKind;                       // 0 = points, 1 = blocks
uniform int uColorMode;
uniform vec2 uZRange, uChanDoc;
uniform float uPaletteN, uIntensityScale;
uniform float uFilterOn, uSelOn, uRuleOn, uChanTexOn;
uniform vec4 uNoData;                   // blank values (chan.js code 0 / the value texture's BLANK): rgb + a (a < 0.5 = hidden)
uniform float uNoDataOn;                // off: a blank clamps to the lowest colour, the old picture
uniform vec3 uLightDir, uCutNormal;
uniform vec3 uFaceN[6];                  // gl-pick's FACE_NORMALS
uniform float uEdgesOn, uOrtho, uPerspScale;
uniform mat4 uInvVP;                     // inverse viewProj: (pixel, depth) → world hit point
uniform vec2 uViewport;
uniform vec3 uEyePos, uGridOrigin, uGridSize;   // the blocks layer's lattice (regular grids only)
uniform mat3 uGridRot;                   // a rotated lattice (world ← lattice); uRotOn = 0 → identity, untouched path
uniform float uRotOn;
out vec4 outColor;
// a ROTATED lattice's edge term: the same reconstruction as the axis-aligned
// one below, done in the LATTICE frame (q = Rᵀ·(p − origin)): the face plane is
// a lattice plane, the centre snaps on the lattice, and the 2×2 quad rays are
// carried into the same frame. → vec2(e, fw) and the lattice-frame centre.
vec3 rotEdge(vec3 p, vec3 ro, vec3 rd, uint face, vec3 half_, out vec3 cL) {
  mat3 Rt = transpose(uGridRot);
  vec3 pL = Rt * (p - uGridOrigin), roL = Rt * (ro - uGridOrigin), rdL = Rt * rd;
  float pv = 0.0; int ax = 0;
  if (face < 6u) {
    ax = int(face >> 1);
    float o0 = -half_[ax];
    pv = o0 + round((pL[ax] - o0) / uGridSize[ax]) * uGridSize[ax];
    if (abs(rdL[ax]) > 1e-12) pL = roL + rdL * ((pv - roL[ax]) / rdL[ax]);
    pL[ax] = pv;
  }
  vec3 baseL = face < 6u ? pL - (Rt * uFaceN[face]) * half_ : pL;   // uFaceN holds R·n here: back to the lattice face
  cL = round(baseL / uGridSize) * uGridSize;
  vec3 a2 = abs(pL - cL) / half_;
  float m1 = max(a2.x, max(a2.y, a2.z));
  float m2 = max(min(a2.x, a2.y), min(max(a2.x, a2.y), a2.z));
  float e = face == 6u ? m1 : m2;
  vec3 cutNL = Rt * uCutNormal;
  float cutD = dot(pL, cutNL);
  vec2 qb = floor(gl_FragCoord.xy * 0.5) * 2.0 + 0.5;
  float eq[3];
  for (int k = 0; k < 3; k++) {
    vec2 fxy = k == 0 ? qb : (k == 1 ? qb + vec2(1.0, 0.0) : qb + vec2(0.0, 1.0));
    vec2 nxy = (fxy / uViewport) * 2.0 - 1.0;
    vec4 qA = uInvVP * vec4(nxy, -1.0, 1.0);
    vec4 qB = uInvVP * vec4(nxy, 1.0, 1.0);
    vec3 qo = Rt * (qA.xyz / qA.w - uGridOrigin), qd = Rt * (qB.xyz / qB.w - qA.xyz / qA.w);
    vec3 q;
    if (face < 6u) { float den = qd[ax]; q = abs(den) > 1e-12 ? qo + qd * ((pv - qo[ax]) / den) : pL; }
    else { float den = dot(qd, cutNL); q = abs(den) > 1e-9 ? qo + qd * ((cutD - dot(qo, cutNL)) / den) : pL; }
    vec3 aq = abs(q - cL) / half_;
    float q1 = max(aq.x, max(aq.y, aq.z));
    float q2 = max(min(aq.x, aq.y), min(max(aq.x, aq.y), aq.z));
    eq[k] = face == 6u ? q1 : q2;
  }
  return vec3(e, abs(eq[1] - eq[0]) + abs(eq[2] - eq[0]), 0.0);
}
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  uvec2 id = texelFetch(uId, px, 0).rg;
  if (id.g == 0xFFFFFFFFu) discard;                        // background: untouched
  uint layer = id.g & 0xFFFFu;
  if (layer != uLayerId) discard;                          // mesh / other layers: untouched
  int rec = int(id.r);
  ivec2 at = ivec2(rec & 8191, rec >> 13);
  vec4 attr = texelFetch(uAttr, at, 0);
  float cls = attr.z;
  if (uRuleOn > 0.5) cls = floor(texelFetch(uRule, at, 0).r * 255.0 + 0.5);
  vec4 col;
  if (uColorMode == 0) {                                   // elevation (both kinds)
    float t = clamp((attr.x - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    col = texture(uRamp, vec2(t, 0.5));
  } else if (uColorMode == 1) {
    if (uKind == 1 || uChanTexOn > 0.5) {                  // blocks' grade, or a value texture (any kind): doc-normalized
      float v = uChanTexOn > 0.5 ? texelFetch(uChanTex, at, 0).r : attr.y;
      bool blank = uChanTexOn > 0.5 ? v < -1.0e37 : attr.w > 0.5;
      if (blank && uNoDataOn > 0.5) col = vec4(uNoData.rgb, 1.0);   // (hidden blanks were culled: not in the id buffer)
      else {
        float t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0);
        col = texture(uRamp, vec2(t, 0.5));
      }
    } else {                                               // points: intensity
      float t = clamp(attr.y * uIntensityScale, 0.0, 1.0);
      col = texture(uRamp, vec2(t, 0.5));
    }
  } else if (uColorMode == 2) {                            // category / classification
    col = texture(uPalette, vec2((cls + 0.5) / uPaletteN, 0.5));
  } else {
    if (uKind == 1) col = vec4(0.62, 0.63, 0.66, 1.0);     // blocks: solid
    else {                                                 // points: rgb (unpack)
      float p3 = attr.w;
      float b = floor(p3 / 65536.0); p3 -= b * 65536.0;
      float g = floor(p3 / 256.0); p3 -= g * 256.0;
      col = vec4(p3 / 255.0, g / 255.0, b / 255.0, 1.0);
    }
  }
  float m = 1.0;
  if (uFilterOn > 0.5) m = texelFetch(uMask, at, 0).r > 0.5 ? 1.0 : 0.0;
  float selHit = uSelOn > 0.5 ? texelFetch(uSel, at, 0).r : 0.0;
  // wash order matches each kind's raster shader EXACTLY: gl.js points dim
  // THEN sel-wash; gl-blocks sel-washes THEN dims. Only both-at-once pixels
  // differ between the orders, but parity is the contract here.
  if (uKind == 1) {
    if (selHit > 0.5) col = vec4(mix(col.rgb, vec3(1.0, 0.85, 0.3), 0.55), col.a);
    if (uFilterOn > 0.5 && m < 0.5) col = vec4(col.rgb * 0.3, col.a);
  } else {
    if (uFilterOn > 0.5 && m < 0.5) col = vec4(col.rgb * 0.3, col.a);
    if (selHit > 0.5) col = vec4(mix(col.rgb, vec3(1.0, 0.85, 0.3), 0.55), col.a);
  }
  if (id.r == uPicked && layer == uPickedLayer) col = vec4(mix(col.rgb, vec3(1.0, 0.15, 0.7), 0.85) + 0.1, col.a);
  float shade = 1.0;
  if (uKind == 1) {                                        // blocks: per-face impostor lighting
    uint face = (id.g >> 16) & 7u;
    if (face < 6u) shade = 0.55 + 0.45 * max(dot(uFaceN[face], uLightDir), 0.0);
    else if (face == 6u) shade = (0.55 + 0.45 * max(dot(uCutNormal, uLightDir), 0.0)) * 0.85;   // the section cut wall
    // face 7 (NO_FACE): a demoted splat — unlit, as rasterized (and no edges)
    // BLOCK EDGE LINES (gl-blocks' exact math): the capture depth gives back
    // the hit point — unproject it, snap the block center from the face plane
    // + the regular lattice, and the box-local coords fall out. Sub-blocked
    // models (per-block half-dims) can't reconstruct the center this way and
    // fall back to the re-raster before we get here.
    if (uEdgesOn > 0.5 && face < 7u && uRotOn > 0.5) {   // a rotated lattice: the same, in its own frame
      float dz = texelFetch(uDepth, px, 0).r;
      vec2 xy = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
      vec4 hp = uInvVP * vec4(xy, dz * 2.0 - 1.0, 1.0);
      vec4 rA = uInvVP * vec4(xy, -1.0, 1.0);
      vec4 rB = uInvVP * vec4(xy, 1.0, 1.0);
      vec3 ro = rA.xyz / rA.w, rd = rB.xyz / rB.w - ro;
      vec3 half_ = uGridSize * 0.5, cL;
      vec3 ef = rotEdge(hp.xyz / hp.w, ro, rd, face, half_, cL);
      float dpx = (1.0 - ef.x) / max(ef.y, 1e-6);
      float edge = 1.0 - clamp(dpx * 0.7 - 0.3, 0.0, 1.0);
      float distE = uOrtho > 0.5 ? 1.0 : max(distance(uEyePos, uGridOrigin + uGridRot * cL), 1e-3);
      float pxR = length(half_) * uPerspScale / distE;
      edge *= clamp((pxR - 5.0) / 8.0, 0.0, 1.0);
      shade *= 1.0 - 0.4 * edge;
    } else if (uEdgesOn > 0.5 && face < 7u) {
      float dz = texelFetch(uDepth, px, 0).r;
      vec2 xy = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
      vec4 hp = uInvVP * vec4(xy, dz * 2.0 - 1.0, 1.0);
      vec3 p = hp.xyz / hp.w;
      vec3 half_ = uGridSize * 0.5;
      // the pixel ray (also perturbed rays below, for the analytic derivative)
      vec4 rA = uInvVP * vec4(xy, -1.0, 1.0);
      vec4 rB = uInvVP * vec4(xy, 1.0, 1.0);
      vec3 ro = rA.xyz / rA.w, rd = rB.xyz / rB.w - ro;
      float pv = 0.0; int ax = 0;
      if (face < 6u) {
        // depth only PICKS the lattice face plane; the position comes from
        // re-intersecting the ray with that exact plane (no 24-bit jitter)
        ax = int(face >> 1);
        float o0 = uGridOrigin[ax] - half_[ax];
        pv = o0 + round((p[ax] - o0) / uGridSize[ax]) * uGridSize[ax];
        if (abs(rd[ax]) > 1e-12) p = ro + rd * ((pv - ro[ax]) / rd[ax]);
        p[ax] = pv;
      }
      vec3 base = face < 6u ? p - uFaceN[face] * half_ : p;   // face pixel: step inward; cut pixel: already interior
      vec3 center = uGridOrigin + vec3(round((base.x - uGridOrigin.x) / uGridSize.x), round((base.y - uGridOrigin.y) / uGridSize.y), round((base.z - uGridOrigin.z) / uGridSize.z)) * uGridSize;
      vec3 a2 = abs(p - center) / half_;
      float m1 = max(a2.x, max(a2.y, a2.z));
      float m2 = max(min(a2.x, a2.y), min(max(a2.x, a2.y), a2.z));
      float e = face == 6u ? m1 : m2;
      // ANALYTIC screen derivative of e: fwidth() cancels at block seams (e is
      // symmetric across them — …0.8, 1.0 │ 1.0, 0.8…), erasing the lines
      // exactly where they live; the raster never sees that because each
      // impostor is its own primitive with helper-invocation derivatives. So
      // evaluate e at the hardware's own 2×2 QUAD positions — rays through the
      // quad-aligned pixels, intersected with THIS pixel's plane — and
      // difference them ourselves. Quad alignment matters: it reproduces the
      // raster's per-quad-shared derivative, phase and all.
      float cutD = dot(p, uCutNormal);
      vec2 qb = floor(gl_FragCoord.xy * 0.5) * 2.0 + 0.5;
      float eq[3];
      for (int k = 0; k < 3; k++) {
        vec2 fxy = k == 0 ? qb : (k == 1 ? qb + vec2(1.0, 0.0) : qb + vec2(0.0, 1.0));
        vec2 nxy = (fxy / uViewport) * 2.0 - 1.0;
        vec4 qA = uInvVP * vec4(nxy, -1.0, 1.0);
        vec4 qB = uInvVP * vec4(nxy, 1.0, 1.0);
        vec3 qo = qA.xyz / qA.w, qd = qB.xyz / qB.w - qo;
        vec3 q;
        if (face < 6u) { float den = qd[ax]; q = abs(den) > 1e-12 ? qo + qd * ((pv - qo[ax]) / den) : p; }
        else { float den = dot(qd, uCutNormal); q = abs(den) > 1e-9 ? qo + qd * ((cutD - dot(qo, uCutNormal)) / den) : p; }
        vec3 aq = abs(q - center) / half_;
        float q1 = max(aq.x, max(aq.y, aq.z));
        float q2 = max(min(aq.x, aq.y), min(max(aq.x, aq.y), aq.z));
        eq[k] = face == 6u ? q1 : q2;
      }
      float fw = abs(eq[1] - eq[0]) + abs(eq[2] - eq[0]);
      float dpx = (1.0 - e) / max(fw, 1e-6);
      float edge = 1.0 - clamp(dpx * 0.7 - 0.3, 0.0, 1.0);
      float distE = uOrtho > 0.5 ? 1.0 : max(distance(uEyePos, center), 1e-3);
      float pxR = length(half_) * uPerspScale / distE;
      edge *= clamp((pxR - 5.0) / 8.0, 0.0, 1.0);          // fade toward demotion, as rasterized
      shade *= 1.0 - 0.4 * edge;
    }
  }
  outColor = vec4(col.rgb * shade, col.a);
}`;

function createResolvePipeline(gl) {
  // the bake target is RGBA32F — color-renderable only with this extension;
  // absent (rare on WebGL2-era GPUs) the whole feature quietly disables and
  // every cosmetic change re-rasters, exactly as before.
  const floatOk = !!gl.getExtension('EXT_color_buffer_float');
  const bakeBlocks = makeProgram(gl, BAKE_VERT_BLOCKS, BAKE_FRAG);
  const bakePoints = makeProgram(gl, BAKE_VERT_POINTS, BAKE_FRAG);
  const resolveProg = makeProgram(gl, RESOLVE_VERT, RESOLVE_FRAG);
  const U = (p, n) => gl.getUniformLocation(p, n);
  const uB = { gridOrigin: U(bakeBlocks, 'uGridOrigin'), gridSize: U(bakeBlocks, 'uGridSize'), gridRot: U(bakeBlocks, 'uGridRot'), chanChunk: U(bakeBlocks, 'uChanChunk'), texSize: U(bakeBlocks, 'uTexSize') };
  const uP = { boxMin: U(bakePoints, 'uBoxMin'), boxSpan: U(bakePoints, 'uBoxSpan'), texSize: U(bakePoints, 'uTexSize') };
  const uR = {
    id: U(resolveProg, 'uId'), attr: U(resolveProg, 'uAttr'), ramp: U(resolveProg, 'uRamp'), palette: U(resolveProg, 'uPalette'),
    mask: U(resolveProg, 'uMask'), sel: U(resolveProg, 'uSel'), rule: U(resolveProg, 'uRule'), chanTex: U(resolveProg, 'uChanTex'),
    layerId: U(resolveProg, 'uLayerId'), picked: U(resolveProg, 'uPicked'), pickedLayer: U(resolveProg, 'uPickedLayer'),
    kind: U(resolveProg, 'uKind'), colorMode: U(resolveProg, 'uColorMode'), zRange: U(resolveProg, 'uZRange'), chanDoc: U(resolveProg, 'uChanDoc'),
    paletteN: U(resolveProg, 'uPaletteN'), intensityScale: U(resolveProg, 'uIntensityScale'),
    filterOn: U(resolveProg, 'uFilterOn'), selOn: U(resolveProg, 'uSelOn'), ruleOn: U(resolveProg, 'uRuleOn'), chanTexOn: U(resolveProg, 'uChanTexOn'), noData: U(resolveProg, 'uNoData'), noDataOn: U(resolveProg, 'uNoDataOn'),
    lightDir: U(resolveProg, 'uLightDir'), cutNormal: U(resolveProg, 'uCutNormal'), faceN: U(resolveProg, 'uFaceN'),
    depth: U(resolveProg, 'uDepth'), edgesOn: U(resolveProg, 'uEdgesOn'), ortho: U(resolveProg, 'uOrtho'), perspScale: U(resolveProg, 'uPerspScale'),
    invVP: U(resolveProg, 'uInvVP'), viewport: U(resolveProg, 'uViewport'), eyePos: U(resolveProg, 'uEyePos'),
    gridOrigin: U(resolveProg, 'uGridOrigin'), gridSize: U(resolveProg, 'uGridSize'), gridRot: U(resolveProg, 'uGridRot'), rotOn: U(resolveProg, 'uRotOn'),
  };
  const IDENT4 = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const bakeFbo = gl.createFramebuffer();
  const bakes = new Map();                                 // layerId → { tex, h }
  const faceFlat = new Float32Array(18), faceRot = new Float32Array(18);
  for (let i = 0; i < 6; i++) { const n = FACE_NORMALS[i]; faceFlat[i * 3] = n[0]; faceFlat[i * 3 + 1] = n[1]; faceFlat[i * 3 + 2] = n[2]; }

  // one bake VAO per blocks chunk: the same buffers the instanced VAO uses, but
  // re-pointed per-VERTEX (divisor 0) so one gl.POINTS draw scatters every block
  function blocksBakeVao(c) {
    c = c._src || c;                                       // a view's proxy shares its source's buffers — and this VAO
    if (Object.prototype.hasOwnProperty.call(c, '_bakeVao')) return c._bakeVao;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bIjk); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bChan); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec); gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, 0, 0);
    gl.bindVertexArray(null);
    c._bakeVao = vao;
    return vao;
  }

  return {
    ok: floatOk,
    // (re)bake one layer's attribute texture from its resident chunks.
    // maxRec = 1 + the highest record index the caller has seen for the layer.
    // Leaves the FBO at null and the viewport at the bake size — the caller
    // (inside the EDL sceneDraw) restores its own binding + viewport after.
    bakeLayer(layerId, chunksOfLayer, maxRec) {
      if (!floatOk || !chunksOfLayer.length || !maxRec) return null;
      const h = Math.max(1, Math.ceil(maxRec / TEXW));
      let b = bakes.get(layerId);
      if (!b || b.h < h) {
        if (b) { gl.deleteTexture(b.tex); bakes.delete(layerId); }
        // 16 B a record: past MAX_TEXTURE_SIZE rows, or when the GPU can't find the
        // memory, there is no bake — null, and the layer re-rasters instead (always
        // correct, just slower). It used to allocate unchecked and resolve garbage.
        if (h > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return null;
        while (gl.getError() !== gl.NO_ERROR) { /* drain stale errors */ }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEXW, h, 0, gl.RGBA, gl.FLOAT, null);
        if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(tex); return null; }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        b = { tex, h };
        bakes.set(layerId, b);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.tex, 0);
      gl.viewport(0, 0, TEXW, b.h);
      gl.disable(gl.DEPTH_TEST);
      const kind = chunksOfLayer[0].kind;
      if (kind === 'blocks') {
        gl.useProgram(bakeBlocks);
        gl.uniform2f(uB.texSize, TEXW, b.h);
        for (const c of chunksOfLayer) {
          const g = c.grid;
          gl.uniform3f(uB.gridOrigin, g.originLocal[0], g.originLocal[1], g.originLocal[2]);
          gl.uniform3f(uB.gridSize, g.size[0], g.size[1], g.size[2]);
          gl.uniformMatrix3fv(uB.gridRot, false, g.rot || IDENTITY3);
          const dq = chanDequant(c.chanRange);
          gl.uniform2f(uB.chanChunk, dq[0], dq[1]);
          gl.bindVertexArray(blocksBakeVao(c));
          gl.drawArrays(gl.POINTS, 0, c.count);
        }
      } else {
        gl.useProgram(bakePoints);
        gl.uniform2f(uP.texSize, TEXW, b.h);
        for (const c of chunksOfLayer) {
          const bb = c.bboxLocal;
          gl.uniform3f(uP.boxMin, bb[0], bb[1], bb[2]);
          gl.uniform3f(uP.boxSpan, bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
          gl.bindVertexArray(c.vao);                       // per-vertex layout already, locations match
          gl.drawArrays(gl.POINTS, 0, c.count);
        }
      }
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return b;
    },
    hasBake(layerId) { return bakes.has(layerId); },
    dropBake(layerId) { const b = bakes.get(layerId); if (b) { gl.deleteTexture(b.tex); bakes.delete(layerId); } },
    // one fullscreen pass for one layer, into the CURRENTLY BOUND framebuffer
    // (the EDL color buffer). `u` carries the same per-layer values the raster
    // path's begin/setup functions computed. Depth stays untouched.
    resolveLayer(idTex, layerId, u) {
      const b = bakes.get(layerId);
      if (!b) return false;
      gl.useProgram(resolveProg);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      const bind = (unit, loc, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };
      bind(0, uR.id, idTex);
      bind(1, uR.attr, b.tex);
      bind(2, uR.ramp, u.ramp);
      bind(3, uR.palette, u.palette);
      // every float sampler MUST land on a float texture: an unset sampler
      // uniform defaults to unit 0 — the INTEGER id texture — and that type
      // mismatch silently kills the whole draw (GL_INVALID_OPERATION). The
      // ramp parks the unused ones; their On-flags gate actual sampling.
      bind(4, uR.mask, u.mask || u.ramp);
      bind(5, uR.sel, u.sel || u.ramp);
      bind(6, uR.rule, u.rule || u.ramp);
      bind(7, uR.chanTex, u.chanTex || u.ramp);
      bind(8, uR.depth, (u.edges && u.depth) || u.ramp);   // depth-as-sampler2D: .r is the depth (compare mode NONE)
      gl.uniform1f(uR.edgesOn, u.edges && u.depth ? 1 : 0);
      gl.uniform1f(uR.ortho, u.ortho ? 1 : 0);
      gl.uniform1f(uR.perspScale, u.perspScale || 1);
      gl.uniformMatrix4fv(uR.invVP, false, u.invVP || IDENT4);
      gl.uniform2f(uR.viewport, u.viewportW || 1, u.viewportH || 1);
      gl.uniform3f(uR.eyePos, u.eye ? u.eye[0] : 0, u.eye ? u.eye[1] : 0, u.eye ? u.eye[2] : 0);
      gl.uniform3f(uR.gridOrigin, u.grid ? u.grid.originLocal[0] : 0, u.grid ? u.grid.originLocal[1] : 0, u.grid ? u.grid.originLocal[2] : 0);
      gl.uniform3f(uR.gridSize, u.grid ? u.grid.size[0] : 1, u.grid ? u.grid.size[1] : 1, u.grid ? u.grid.size[2] : 1);
      gl.uniform1ui(uR.layerId, layerId >>> 0);
      gl.uniform1ui(uR.picked, u.picked >>> 0);
      gl.uniform1ui(uR.pickedLayer, u.pickedLayer >>> 0);
      gl.uniform1i(uR.kind, u.kind === 'blocks' ? 1 : 0);
      gl.uniform1i(uR.colorMode, u.colorMode | 0);
      gl.uniform2f(uR.zRange, u.zRange[0], u.zRange[1]);
      gl.uniform2f(uR.chanDoc, u.chanDoc[0], u.chanDoc[1]);
      gl.uniform1f(uR.paletteN, u.paletteN);
      gl.uniform1f(uR.intensityScale, u.intensityScale);
      gl.uniform1f(uR.filterOn, u.mask ? 1 : 0);
      gl.uniform1f(uR.selOn, u.sel ? 1 : 0);
      gl.uniform1f(uR.ruleOn, u.rule ? 1 : 0);
      gl.uniform1f(uR.chanTexOn, u.chanTex ? 1 : 0);
      gl.uniform1f(uR.noDataOn, u.noData ? 1 : 0);
      if (u.noData) gl.uniform4f(uR.noData, u.noData[0], u.noData[1], u.noData[2], u.noData[3]);
      gl.uniform3f(uR.lightDir, u.lightDir[0], u.lightDir[1], u.lightDir[2]);
      gl.uniform3f(uR.cutNormal, u.cutNormal[0], u.cutNormal[1], u.cutNormal[2]);
      // a ROTATED lattice's face ids name lattice faces: the shading normal is R·n,
      // as gl-blocks computes it (n = uGridRot * n); the edge term runs in the
      // lattice frame (rotEdge). Identity → the untouched axis-aligned path.
      const R = u.grid && u.grid.rot;
      if (R) {
        for (let i = 0; i < 6; i++) {
          const n = FACE_NORMALS[i];
          for (let a = 0; a < 3; a++) faceRot[i * 3 + a] = R[a] * n[0] + R[3 + a] * n[1] + R[6 + a] * n[2];
        }
        gl.uniformMatrix3fv(uR.gridRot, false, R);
      }
      gl.uniform1f(uR.rotOn, R ? 1 : 0);
      gl.uniform3fv(uR.faceN, R ? faceRot : faceFlat);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
      return true;
    },
    clear() { for (const b of bakes.values()) gl.deleteTexture(b.tex); bakes.clear(); },
  };
}

// ── src/core/gl.js ──

// @gcu/condenser — the WebGL2 splat renderer. Raw GL, no scene graph: per-chunk
// VAOs over the quantized buffers (positions stay uint16 on the GPU — denormalized
// in the vertex shader against per-chunk bbox uniforms), circular point splats,
// color-by as a mode uniform + LUT texture (switching color source is a uniform/
// texture swap, never a buffer re-upload — micro-spec §2.2).
//
// Prefix-LOD (M1 form): a global per-frame element budget split across visible
// chunks proportionally; each chunk draws its FIRST k elements — correct as a
// uniform subsample because chunks.js shuffled them (the §2.1.4 invariant).


const VERT$gl = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;        // uint16 normalized -> 0..1
layout(location=1) in float aIntensity; // uint16 normalized
layout(location=2) in float aClass;     // uint8, raw (0..255)
layout(location=3) in vec3 aRgb;        // uint8 normalized
layout(location=4) in uint aRec;        // uint32 record index (highlight + mask lookups)
uniform uint uPicked;                   // picked RECORD (0xFFFFFFFF = none)
uniform uint uPickedLayer;              // …and the layer it belongs to
uniform uint uLayer;                    // this draw's layer (per-draw, not per-element)                   // record index to highlight (0xFFFFFFFF = none)
uniform uvec2 uRepaint;                 // repaint pass: draw ONLY these two records (both 0xFFFFFFFF = off)
uniform vec4 uSecPlane;                 // section plane: xyz = unit normal, w = offset (frame-local)
uniform vec2 uSecCfg;                   // x: 0 = off, 1 = slab; y: slab half-thickness
uniform mat4 uViewProj;
uniform vec3 uBoxMin, uBoxSpan;
uniform float uPointPx;
uniform int uColorMode;                 // 0 elevation | 1 intensity | 2 classification | 3 rgb
uniform vec2 uZRange;                   // document local z min/span (elevation ramp)
uniform float uIntensityScale;          // 1 / (p98-ish max, normalized units)
uniform sampler2D uRamp;                // 256x1 continuous ramp
uniform vec4 uNoData;                   // blank values (chan.js code 0 / the value texture's BLANK): rgb + a (a < 0.5 = hidden)
uniform float uNoDataOn;                // off: a blank clamps to the lowest colour, the old picture
uniform sampler2D uPalette;             // classification / category palette
uniform float uPaletteN;                // its width (32 = LAS classes, 256 = category dict)
uniform sampler2D uMask;                // filter bitmask by record index (8192-wide)
uniform float uFilterOn, uIsolate;
uniform float uGhost;                   // the GHOST pass (gl-ghost.js): only the records the filter leaves out
uniform sampler2D uCatVis;              // 256x1 per-class visibility (layer properties)
uniform float uCatVisOn;
uniform sampler2D uSel;                 // selection bitmask by record index (8192-wide)
uniform float uSelOn;
uniform sampler2D uRule;                // rule-code byte by record index (8192-wide)
uniform float uRuleOn;                  // rule mode: the code REPLACES the class for palette + eyes
uniform sampler2D uChanTex;             // OPT-IN: raw f32 VALUE by record (8192-wide) — replaces the
uniform float uChanTexOn;               // intensity slot in mode 1, normalized over uChanDoc (the
uniform vec2 uChanDoc;                  // document's range + clip), as gl-blocks does
#ifdef MIP
uniform float uMipCodes;                // 1 = project the rule CODE (a numeric ƒ / painted column)
#endif
out vec4 vColor;
flat out float vCull;
void main() {
  vec3 p = uBoxMin + aPos * uBoxSpan;
  gl_Position = uViewProj * vec4(p, 1.0);
  gl_PointSize = uPointPx;
  vCull = (uSecCfg.x > 0.5 && abs(dot(p, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y) ? 1.0 : 0.0;
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
    if (uIsolate > 0.5 && m < 0.5) vCull = 1.0;
    if (uGhost > 0.5 && m > 0.5) vCull = 1.0;
  }
  float cls = aClass;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  float selHit = 0.0;
  if (uSelOn > 0.5) {
    int rs = int(aRec);
    selHit = texelFetch(uSel, ivec2(rs & 8191, rs >> 13), 0).r;
  }
  float mipT = 0.0; bool mipBlank = true;                 // the value a PROJECTION reads (gl-mip.js)
  if (uColorMode == 0) {
    float t = clamp((p.z - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    vColor = texture(uRamp, vec2(t, 0.5));
    if (vColor.a < 0.5) vCull = 1.0;                      // a hidden class: the ramp texel's alpha is 0
  } else if (uColorMode == 1) {
    float t;
    bool blank = false;
    if (uChanTexOn > 0.5) {
      int rc = int(aRec);
      float v = texelFetch(uChanTex, ivec2(rc & 8191, rc >> 13), 0).r;
      blank = v < -1.0e37;                                 // the value texture's BLANK
      t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0);
    } else t = clamp(aIntensity * uIntensityScale, 0.0, 1.0);
    mipT = t; mipBlank = blank;
    if (blank && uNoDataOn > 0.5) {
      vColor = vec4(uNoData.rgb, 1.0);
      if (uNoData.a < 0.5) vCull = 1.0;
    } else {
      vColor = texture(uRamp, vec2(t, 0.5));
      if (vColor.a < 0.5) vCull = 1.0;
    }
  } else if (uColorMode == 2) {
    vColor = texture(uPalette, vec2((cls + 0.5) / uPaletteN, 0.5));
  } else {
    vColor = vec4(aRgb, 1.0);
  }
  if (uFilterOn > 0.5 && m < 0.5) vColor = vec4(vColor.rgb * 0.3, vColor.a);   // context mode: dim non-matching
  if (selHit > 0.5) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.85, 0.3), 0.55), vColor.a);   // selected: warm gold wash
  if (aRec == uPicked && uLayer == uPickedLayer) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.15, 0.7), 0.85) + 0.1, vColor.a);   // picked: hot magenta — the hue viridis doesn't have
  if ((uRepaint.x != 0xFFFFFFFFu || uRepaint.y != 0xFFFFFFFFu) && aRec != uRepaint.x && aRec != uRepaint.y) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // repaint pass: everything else clips out
#ifdef MIP
  // a PROJECTION (gl-mip.js): R = the normalized value, G = 1 (the mean's count) —
  // or nothing: blanks and filtered-out points (dim or isolate) don't contribute.
  // A NUMERIC CODE layer (a ƒ / painted column: rule codes rise with the value,
  // 0 = blank) projects its code, composited back through its palette
  if (uMipCodes > 0.5) { mipT = cls / 255.0; mipBlank = uColorMode != 2 || cls < 0.5; }
  else if (uColorMode != 1) mipBlank = true;
  if (mipBlank || m < 0.5) vCull = 1.0;
  vColor = vec4(mipT, 1.0, 0.0, 1.0);
#endif
}`;

const FRAG$gl = `#version 300 es
precision highp float;
in vec4 vColor;
flat in float vCull;
out vec4 outColor;
void main() {
  if (vCull > 0.5) discard;             // outside the section slab
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;        // circular splat
  outColor = vColor;
}`;


// ── LUTs ──
// A small viridis-ish ramp (Switchboard-friendly; perceptual enough for v0.1).
const RAMP_STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
function rampPixels(n = 256, stops = RAMP_STOPS) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * (stops.length - 1), k = Math.min(stops.length - 2, t | 0), f = t - k;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(stops[k][c] * (1 - f) + stops[k + 1][c] * f);
    out[i * 4 + 3] = 255;
  }
  return out;
}
// Standard LAS classification palette (0..18+; index = class code).
const CLASS_COLORS = {
  0: [140, 144, 153], 1: [170, 170, 170], 2: [161, 124, 82], 3: [122, 168, 100],
  4: [90, 150, 70], 5: [60, 130, 60], 6: [200, 105, 84], 7: [220, 80, 80],
  8: [180, 180, 90], 9: [74, 120, 176], 10: [200, 160, 60], 11: [110, 110, 120],
  12: [235, 100, 60], 13: [180, 140, 200], 14: [140, 120, 220], 15: [120, 200, 200],
  16: [200, 200, 120], 17: [160, 90, 160], 18: [230, 150, 150],
};
function palettePixels(n = 32) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = CLASS_COLORS[i] || [200, 60, 200];           // unknown classes scream magenta, quietly
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

function lutTexture(gl, pixels, n) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  return t;
}

// Upload one chunk's buffers → a VAO. CPU copies are the caller's to release —
// after this returns, the GPU owns the data (§2.1.5 CPU-release). recIdx goes up
// too (an unattached buffer, wired by the M5 pick pass) so nothing per-element
// has to stay resident in JS.
function uploadChunk(gl, chunk) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = (data, loc, size, type, normalized) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    return b;
  };
  const buffers = [
    buf(chunk.pos, 0, 3, gl.UNSIGNED_SHORT, true),
    buf(chunk.intensity, 1, 1, gl.UNSIGNED_SHORT, true),
    buf(chunk.classification, 2, 1, gl.UNSIGNED_BYTE, false),
  ];
  if (chunk.rgb) buffers.push(buf(chunk.rgb, 3, 3, gl.UNSIGNED_BYTE, true));
  else { gl.disableVertexAttribArray(3); gl.vertexAttrib3f(3, 0.7, 0.7, 0.7); }
  const recBuf = gl.createBuffer();                        // highlight + pick lookups, GPU-resident
  gl.bindBuffer(gl.ARRAY_BUFFER, recBuf);
  gl.bufferData(gl.ARRAY_BUFFER, chunk.recIdx, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, 0);
  buffers.push(recBuf);
  gl.bindVertexArray(null);
  return { kind: 'points', vao, buffers, count: chunk.count, bboxLocal: chunk.bboxLocal, cursor: 0 };
}

/**
 * createRenderer(canvas) — owns the GL context, program, LUTs, and the chunk
 * list; draw(cam, opts) renders one frame (into the current framebuffer — the
 * EDL pass wraps it). Chunks arrive via addChunk() as the stream lands.
 *
 * M2 state machine (§2.2): each frame classifies as MOVING (camera/viewport/
 * uniform changed since last frame) or STILL.
 *   moving → clear + draw a per-chunk PREFIX: k_i = budget · w_i/Σw where w_i is
 *   the chunk's projected screen weight ((radius/dist)², floored so the coarse
 *   global prefix never disappears), front-to-back over the frustum-culled set.
 *   still  → no clear; draw the NEXT SLICE of each unfinished visible chunk
 *   (progressive accumulation into the persistent FBO) until converged.
 * New chunks stream INTO the accumulation (no clear — they just draw behind).
 * All of it is correct because chunk prefixes are uniform subsamples (§2.1.4).
 */
function createRenderer(canvas, { background = [0.07, 0.07, 0.07, 1], maxPixelRatio = Infinity } = {}) {
  // preserveDrawingBuffer: the viewport is also the screenshot-export surface
  // (micro-spec §6) and readPixels-after-frame is how the smoke verifies renders;
  // the cost is one buffer copy per composite — negligible next to the splat pass.
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('condenser: WebGL2 unavailable');
  // the points program — and its projection twin (gl-mip.js), built on first use
  const ptsProgram = (defs) => {
    const p = makeProgram(gl, withDefines(VERT$gl, defs), withDefines(FRAG$gl, defs));
    const U = (n) => gl.getUniformLocation(p, n);
    return { prog: p, uni: {
      viewProj: U('uViewProj'), boxMin: U('uBoxMin'), boxSpan: U('uBoxSpan'),
      pointPx: U('uPointPx'), colorMode: U('uColorMode'), zRange: U('uZRange'),
      intensityScale: U('uIntensityScale'), ramp: U('uRamp'), palette: U('uPalette'), picked: U('uPicked'), pickedLayer: U('uPickedLayer'), layer: U('uLayer'), repaint: U('uRepaint'),
      secPlane: U('uSecPlane'), secCfg: U('uSecCfg'),
      mask: U('uMask'), filterOn: U('uFilterOn'), isolate: U('uIsolate'), ghost: U('uGhost'), paletteN: U('uPaletteN'),
      catVis: U('uCatVis'), catVisOn: U('uCatVisOn'),
      sel: U('uSel'), selOn: U('uSelOn'),
      rule: U('uRule'), ruleOn: U('uRuleOn'),
      chanTex: U('uChanTex'), chanTexOn: U('uChanTexOn'), chanDoc: U('uChanDoc'), noData: U('uNoData'), noDataOn: U('uNoDataOn'),
      mipCodes: U('uMipCodes'),
    } };
  };
  const ptsNormal = ptsProgram('');
  let ptsMip = null;
  const prog = ptsNormal.prog;
  let uni = ptsNormal.uni;
  let mipPipe = null;                                     // projection targets + composite (gl-mip.js), lazy
  let lastMip = null;                                     // the last frame's projection: { mode, layers, … } — pick() reads it
  let lastMipKey = '';                                    // which layers it projected (a change re-rasters)
  let ghostPipe = null;                                   // ghost filter display targets + composite (gl-ghost.js), lazy
  let logsPipe = null;                                    // drillhole log tracks (gl-logs.js), lazy
  let lightweight = false;                                // a software rasterizer: the heavy optional passes stand down (setLightweight)
  const ramp = lutTexture(gl, rampPixels(), 256);
  const palette = lutTexture(gl, palettePixels(), 32);   // LAS classification (points)
  let catPalette = null;                                  // category palette (blocks), lazy
  let blocksPipe = null;                                  // impostor pipeline, lazy
  let sticksPipe = null;                                  // capsule pipeline, lazy
  let meshPipe = null;                                    // context-mesh pipeline, lazy
  let soupPipe = null;                                    // streaming-mesh (soup) pipeline, lazy
  let pickPipe = null;                                    // ID-buffer pick pipeline, lazy
  let resolvePipe = null;                                 // deferred re-shade pipeline, lazy (gl-resolve.js)
  const chunks = [];
  let docBbox = null;                                     // scene bbox (fit + the shared elevation ramp)
  let pickedRec = 0xFFFFFFFF;                             // highlighted RECORD (sentinel = none)
  let pickedLayer = 0xFFFFFFFF;                           // …and its layer (the pair IS the identity now)
  const repaintSet = new Set();                           // records to repaint over a converged frame
  let lastConverged = false;
  let pickFromCapture = 0;                                // picks answered from the capture (a test seam)
  // ── layers (micro-layers spec §1): each opened dataset is a layer with its own
  // visibility, filter mask, compaction set, and color ranges. recIdx is
  // PARTITIONED — (layerId << 29) | record — so one ID buffer serves all layers
  // (§3). Single-layer callers never notice: layer 0 shifts by zero and every
  // API defaults to it. ──
  const layers = new Map();                               // id → per-layer state
  // a layer's view of the section (sectioned mode + its draw offset) — section.js,
  // shared with the pick pipeline so the pick always agrees with the picture
  const layerSecOf = (ls, sec) => layerSection(sec, ls.sectioned, ls.offset);
  const meshSecOf = (ls, sec) => meshSection(sec, ls.sectioned, ls.offset);
  // a layer's DOCUMENT value range: the opt-in value texture's when one is set
  // (its range IS the document's then), else what the chunks carried. The clip
  // applies over either.
  const docRangeOf = (ls) => ls.chanTex && ls.chanTexRange
    ? [ls.chanTexRange[0], ls.chanTexRange[0] + ls.chanTexRange[1]]
    : [ls.docChan[0] === Infinity ? 0 : ls.docChan[0], ls.docChan[1]];
  // → [lo, span]: the ramp's value window in channel mode — the document range,
  // narrowed by the layer's clip. ONE place for every kind that draws a value.
  const chanDocOf = (ls, o) => {
    const dr = docRangeOf(ls), on = o.clip && o.colorMode === 1;
    const lo = on && o.clip[0] != null ? o.clip[0] : dr[0], hi = on && o.clip[1] != null ? o.clip[1] : dr[1];
    return [lo, hi > lo ? hi - lo : 1];
  };
  function layerOf(id) {
    let l = layers.get(id);
    if (!l) {
      l = { visible: true, set: 'base', maskTex: null, maskH: 0, isolate: false,
            intensityMax: 1, docChan: [Infinity, -Infinity], catN: 0, stickRadius: 1, sectioned: true,
            meshTint: [0.62, 0.64, 0.66], meshOpacity: 1, opacity: 1, catVisTex: null, rampTex: null, rampHides: false, rampAlphaSig: '', noData: null, paletteTex: null, paletteW: 0, selTex: null, selH: 0,
            ruleTex: null, ruleH: 0, ruleOn: false, projCodes: false, ghost: null, ghostColor: null,
            chanTex: null, chanTexRange: null, offset: null };
      layers.set(id, l);
    }
    return l;
  }
  const activeChunk = (c) => { const l = layers.get(c._layer); return !!l && l.visible && c._set === l.set; };
  // a chunk's bbox where it is DRAWN (its layer's offset applied) — culling,
  // depth ordering, LOD weights and the content bbox; the stored bboxLocal stays
  // the geometry's own (it is also the points dequantize box)
  const drawnBox = (c, out) => {
    const l = layers.get(c._layer), o = l && l.offset, b = c.bboxLocal;
    if (!o) return b;
    for (let i = 0; i < 3; i++) { out[i] = b[i] + o[i]; out[i + 3] = b[i + 3] + o[i]; }
    return out;
  };
  // the camera a layer is drawn with: its offset folded in as a translation
  // (camera.js translateState); one object per layer per frame, the shared
  // camera itself when the layer isn't moved
  const camFor = (cam, id, memo) => {
    const l = layers.get(id), o = l && l.offset;
    if (!o) return cam;
    let c = memo && memo.get(id);
    if (!c) { c = { state: translateState(cam.state, o) }; if (memo) memo.set(id, c); }
    return c;
  };
  // ── layer VIEWS: one model drawn as several layers ─────────────────────────
  // A view draws its SOURCE layer's chunks under its own layer id, so everything
  // per layer (filter, selection, ramp, palette, value texture, rule codes,
  // section, offset, opacity, visibility, the pick id) is its own while the GPU
  // geometry exists once. Each source chunk gets a PROXY per view: an object
  // whose prototype is the source chunk (vao, buffers, bbox, count, kind… all
  // read through) with its own layer id and draw progress (cursor, weight,
  // distance — one chunk can't carry two views' accumulation). A proxy owns no
  // GPU objects. The link outlives the source's chunks: a host re-streams a
  // layer by removeLayer(id) + addChunk(…, id), and the views re-proxy the new
  // chunks as they arrive. Only the BASE set is viewed (compaction is per layer).
  const viewSrc = new Map();                               // view id → source id
  const syncViewData = (view) => {                         // what a view reads from the DATA, not its style
    const s = layers.get(viewSrc.get(view)), v = layerOf(view);
    v.docChan = s ? [...s.docChan] : [Infinity, -Infinity];
    v.intensityMax = s ? s.intensityMax : 1;
    layerMaxRec.set(view, layerMaxRec.get(viewSrc.get(view)) || 0);
    bakeDirty.add(view);
  };
  const addProxy = (c, view) => {
    const p = Object.create(c);
    p._src = c; p._layer = view; p._set = 'base'; p.cursor = 0; p._w = 0; p._dist = 0; p.bytes = 0;
    chunks.push(p);
    if (c.kind === 'mesh') needClear = true;               // as for the source: a mesh draws into a fresh accumulation
  };
  const fanOut = (up, set, layer) => {                     // a new source chunk → one proxy per view
    if (set !== 'base' || !viewSrc.size) return;
    for (const [v, s] of viewSrc) if (s === layer) { addProxy(up, v); syncViewData(v); }
  };
  const freeChunk = (c) => { if (logsPipe) logsPipe.forget(c); if (c._src) return; gl.deleteVertexArray(c.vao); if (c._bakeVao) gl.deleteVertexArray(c._bakeVao); c.buffers.forEach((b) => gl.deleteBuffer(b)); };
  const byLayer = (arr) => {
    const m = new Map();
    for (const c of arr) { let g = m.get(c._layer); if (!g) m.set(c._layer, g = []); g.push(c); }
    return m;
  };
  // accumulation state
  const lastVP = new Float32Array(16);
  let lastKey = '', needClear = true, lastVisible = 0;
  // deferred re-shade state (gl-resolve.js): a COSMETIC change (ramp, clip,
  // color mode, dim-filter, selection, chanTex values) over a converged frame
  // resolves per-pixel from the captured id buffer instead of re-rastering.
  // Dirt is tracked PER LAYER: a ramp drag on the block model must not care
  // that a drillhole (sticks) layer shares the scene — untouched layers keep
  // their accumulated pixels, and only a change to an UNRESOLVABLE layer
  // falls back to the re-raster.
  const cosmeticDirtyLayers = new Set();                  // layers a cosmetic setter touched
  // layers whose RAMP or PALETTE changed (and nothing else, unless they are also in
  // the set above): under a projection that is a re-composite of the layer's
  // accumulated target, not a re-raster — the target holds values, not colours
  const lutDirtyLayers = new Set();
  const lastCosSig = new Map();                           // layer → view-opts signature last rastered/resolved
  let idCapture = null;                                   // { tex, depth, w, h, key, complete } — the converged frame's id buffer
  // what an id buffer depends on besides the geometry: the camera, the point
  // size, points-vs-boxes, the section, the target size
  const capKey = (cam, pointPx, blocksAsPoints, sec) =>
    `${Array.prototype.join.call(cam.state.viewProj, ',')}|${pointPx}|${blocksAsPoints ? 'P' : 'B'}|${sec ? `${sec.n.join(',')}|${sec.d}|${sec.half}` : 'off'}|${canvas.width}x${canvas.height}`;
  // a pending re-raster (needClear) means what is clickable changed — a class eye,
  // a rule code under eyes, visibility — but the capture is only thrown away when
  // the next frame draws; until then it must not answer a pick
  // (under a projection the picture isn't the front surface: picks render live)
  const capReady = (key) => !globalThis.__noPickCapture && !needClear && !lastMip && !!(idCapture && idCapture.complete && idCapture.key === key && idCapture.w === canvas.width && idCapture.h === canvas.height);
  // every capture that is thrown away goes through here, so a fence still pending
  // on it is deleted rather than left to the collector
  const dropCapture = () => { if (idCapture && idCapture.fence) gl.deleteSync(idCapture.fence); idCapture = null; };
  const layerMaxRec = new Map();                          // layer → 1 + highest record index seen
  const bakeDirty = new Set();                            // layers whose attr bake is stale
  let resolves = 0;                                       // resolve passes run (harness observability)
  const trackRec = (layer, recIdx) => {
    let m = layerMaxRec.get(layer) || 0;
    for (let i = 0; i < recIdx.length; i++) if (recIdx[i] >= m) m = recIdx[i] + 1;
    layerMaxRec.set(layer, m);
    bakeDirty.add(layer);
  };

  const vpChanged = (vp) => {
    for (let i = 0; i < 16; i++) if (vp[i] !== lastVP[i]) { lastVP.set(vp); return true; }
    return false;
  };

  // ── per-record byte textures (filter / selection / rule codes) ──────────────
  // 8192 records a row, one byte a record. Uploaded in BANDS of 64 rows from one
  // small reused buffer — it used to allocate (and fill) a full W×H copy on every
  // call, ~50 MB per brush stroke at 50M records. bits: a 0/1 mask (sent as
  // 0/255); otherwise the bytes go up as they are. Past the GPU's
  // MAX_TEXTURE_SIZE rows the texture can't exist: that THROWS, naming the
  // limit — it used to fail silently and the layer drew as if unfiltered.
  const REC_W = 8192, BAND = 64;
  const maxTexRows = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  let bandBuf = null;
  function recordTexture(ls, texKey, hKey, data, bits, what) {
    if (!ArrayBuffer.isView(data)) data = Uint8Array.from(data, (v) => (bits ? (v ? 1 : 0) : v));
    const n = data.length, H = Math.max(1, Math.ceil(n / REC_W));
    if (H > maxTexRows) {
      if (ls[texKey]) { gl.deleteTexture(ls[texKey]); ls[texKey] = null; ls[hKey] = 0; }
      throw new Error(`${what}: ${n.toLocaleString()} records — more than this GPU can index (${(REC_W * maxTexRows).toLocaleString()}, ${maxTexRows} texture rows of ${REC_W})`);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (!(ls[texKey] && H === ls[hKey])) {
      if (ls[texKey]) gl.deleteTexture(ls[texKey]);
      while (gl.getError() !== gl.NO_ERROR) { /* drain stale errors */ }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, REC_W, H);
      if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(tex); ls[texKey] = null; ls[hKey] = 0; throw new Error(`${what}: the GPU could not allocate ${REC_W}×${H} (out of video memory?)`); }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      ls[texKey] = tex; ls[hKey] = H;
    } else gl.bindTexture(gl.TEXTURE_2D, ls[texKey]);
    if (!bandBuf) bandBuf = new Uint8Array(REC_W * BAND);
    for (let r0 = 0; r0 < H; r0 += BAND) {
      const rows = Math.min(BAND, H - r0), a = r0 * REC_W, b = Math.min(n, a + rows * REC_W);
      if (!bits && b - a === rows * REC_W) {                  // whole rows of bytes: straight from the caller's array
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, REC_W, rows, gl.RED, gl.UNSIGNED_BYTE, data.subarray(a, b));
        continue;
      }
      const buf = bandBuf.subarray(0, rows * REC_W);
      if (bits) { for (let i = a; i < b; i++) buf[i - a] = data[i] ? 255 : 0; } else buf.set(data.subarray(a, b));
      buf.fill(0, b - a);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, REC_W, rows, gl.RED, gl.UNSIGNED_BYTE, buf);
    }
  }
  return {
    gl,
    // background clear color (also the figure/screenshot backdrop, since EDL
    // passes through background pixels untouched). rgba 0-1; a moving frame
    // re-clears so it takes effect next redraw.
    setBackground(rgba) { if (rgba && rgba.length >= 3) { background[0] = rgba[0]; background[1] = rgba[1]; background[2] = rgba[2]; background[3] = rgba[3] != null ? rgba[3] : 1; needClear = true; } },
    get background() { return [background[0], background[1], background[2], background[3]]; },
    get chunkCount() { return chunks.reduce((s, c) => s + (activeChunk(c) ? 1 : 0), 0); },
    get elementCount() { return chunks.reduce((s, c) => s + (activeChunk(c) ? c.count : 0), 0); },
    // ALL resident chunks (hidden layers + inactive sets included — they hold
    // their buffers), so the number is what the GPU is actually carrying
    get vramBytes() { return chunks.reduce((s, c) => s + (c.bytes || 0), 0); },
    layerVramBytes(layer) { return chunks.reduce((s, c) => s + (c._layer === layer ? (c.bytes || 0) : 0), 0); },
    get accumulated() { return chunks.reduce((s, c) => s + (activeChunk(c) ? c.cursor : 0), 0); },   // elements in the current accumulation
    get resolveCount() { return resolves; },               // deferred re-shade passes run (harness observability)
    // PROJECTIONS (gl-mip.js): what this GPU offers per mode ({ max, min, mean } →
    // { format, bits, float } | null), the last frame's projection ({ mode, layers,
    // drawn, total, exact } | null), and a layer's projected values as drawn —
    // { data: Float32Array of normalized t per device pixel, rows bottom-up, NaN
    // where nothing projected; w, h, format, mode } | null
    get projectionSupport() { if (!mipPipe) mipPipe = createMipPipeline(gl); return mipPipe.support(); },
    get projection() { return lastMip ? { ...lastMip, layers: [...lastMip.layers] } : null; },
    projectionValues(layer) { return mipPipe ? mipPipe.read(layer) : null; },
    addChunk(chunk, set = 'base', layer = 0) {
      if (viewSrc.has(layer)) throw new Error(`renderer: layer ${layer} is a view — it draws its source's chunks, not its own`);
      const ls = layerOf(layer);
      dropCapture();                                      // new geometry: the captured id buffer is stale
      // recIdx stays RAW — the layer rides a per-draw uniform, so there is no
      // per-element rewrite here any more (and no 3-bit ceiling on layers)
      // honest VRAM accounting: every typed array in the CPU chunk becomes a
      // GPU buffer (bboxLocal's 48 B is noise) — summed here, read as vramBytes
      let cb = 0;
      for (const k in chunk) { const v = chunk[k]; if (v && v.buffer && v.byteLength) cb += v.byteLength; }
      if (chunk.kind === 'mesh') {                        // context tier: static, recordless, whole-draw
        if (!meshPipe) meshPipe = createMeshPipeline(gl);
        const up = meshPipe.upload(chunk); up._set = set; up._layer = layer; up.bytes = cb;
        chunks.push(up);
        needClear = true;                                 // draw it into a fresh accumulation
        fanOut(up, set, layer);
        return;
      }
      if (chunk.kind === 'soup') {                        // streaming tier: budgeted like points
        if (!soupPipe) soupPipe = createSoupPipeline(gl);
        const up = soupPipe.upload(chunk); up._set = set; up._layer = layer; up.bytes = cb;
        chunks.push(up);                                  // streams INTO the accumulation, no clear
        fanOut(up, set, layer);
        return;
      }
      if (chunk.kind === 'blocks' || chunk.kind === 'sticks') {
        if (chunk.kind === 'blocks' && !blocksPipe) blocksPipe = createBlocksPipeline(gl);
        if (chunk.kind === 'sticks' && !sticksPipe) sticksPipe = createSticksPipeline(gl);
        const up = (chunk.kind === 'blocks' ? blocksPipe : sticksPipe).upload(chunk);
        up._set = set; up._layer = layer; up.bytes = cb;
        chunks.push(up);                                   // GPU owns it now
        if (chunk.kind === 'blocks' && chunk.recIdx) trackRec(layer, chunk.recIdx);   // re-shade bake bookkeeping
        if (set === 'base') {                              // compact chunks never tighten the ramp
          if (chunk.chanRange[0] < ls.docChan[0]) ls.docChan[0] = chunk.chanRange[0];
          if (chunk.chanRange[1] > ls.docChan[1]) ls.docChan[1] = chunk.chanRange[1];
        }
        fanOut(up, set, layer);
        return;
      }
      const up = uploadChunk(gl, chunk); up._set = set; up._layer = layer; up.bytes = cb;
      chunks.push(up);                                     // GPU owns it now; CPU copy dies with the caller
      if (chunk.recIdx) trackRec(layer, chunk.recIdx);     // re-shade bake bookkeeping (points)
      if (set === 'base') {
        let m = 0; const a = chunk.intensity;
        for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
        ls.intensityMax = Math.max(ls.intensityMax, m);
      }
      fanOut(up, set, layer);
    },
    // Make `view` a VIEW of `source`: it draws source's chunks under its own layer
    // state (see the note at viewSrc). null unlinks. A view has no chunks of its
    // own, and a view can't be a source (one level, as the host's tree has it).
    setLayerViewOf(view, source) {
      for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i]._src && chunks[i]._layer === view) chunks.splice(i, 1);
      needClear = true; dropCapture();
      if (source == null) { viewSrc.delete(view); return; }
      if (view === source || viewSrc.has(source)) throw new Error('renderer: a view must be of a layer that is not itself a view');
      if ([...viewSrc.values()].includes(view)) throw new Error(`renderer: layer ${view} has views — it can't become one`);
      if (chunks.some((c) => c._layer === view)) throw new Error(`renderer: layer ${view} has chunks of its own — a view has none`);
      viewSrc.set(view, source);
      for (const c of chunks.slice()) if (c._layer === source && c._set === 'base' && !c._src) addProxy(c, view);
      syncViewData(view);
    },
    layerViewOf(view) { return viewSrc.has(view) ? viewSrc.get(view) : null; },
    setCategories(n) {                                     // block category palette (golden-angle hues)
      if (n > 0 && !catPalette) catPalette = lutTexture(gl, categoryPalettePixels(256), 256);
    },
    // Filter bitmask by RECORD INDEX within the layer (micro-spec section 4).
    // mask = Uint8Array (0|1 per source row) or null to clear; isolate: true
    // discards non-matching, false dims them.
    // ghost: null | 'tint' | 'outline' — the GHOST display (gl-ghost.js): the matches drawn as
    // with isolate, the rest as a flat shape behind them (never covering them); ghostColor
    // [r, g, b] 0..1 (null: a faint ink of the background's opposite)
    setFilter(mask, { isolate = false, ghost = null, ghostColor = null } = {}, layer = 0) {
      const ls = layerOf(layer);
      const g = mask && GHOST_STYLES.includes(ghost) ? ghost : null;
      if (g) isolate = true;                                 // a ghost layer's matches draw as isolate's
      const culled = isolate || (ls.isolate && !!ls.maskTex) || g !== ls.ghost;   // isolate CULLS (now or before) → geometry changes
      ls.isolate = isolate;
      ls.ghost = g; ls.ghostColor = g && ghostColor ? [+ghostColor[0], +ghostColor[1], +ghostColor[2]] : null;
      if (!mask) {
        if (ls.maskTex) { gl.deleteTexture(ls.maskTex); ls.maskTex = null; }
      } else {
        recordTexture(ls, 'maskTex', 'maskH', mask, true, 'filter');
      }
      if (culled) needClear = true; else cosmeticDirtyLayers.add(layer);   // dim-mode filter is a re-shade, not a re-raster
    },
    setDocBbox(b) { docBbox = b; },
    // Filter compaction (per layer): 'compact' chunks hold ONLY matching elements
    // (record ids preserved), so the render budget runs over the matches instead
    // of shader-discarding the rest. Base chunks stay resident — clearing is instant.
    setActiveSet(set, layer = 0) { const ls = layerOf(layer); if (set !== ls.set) { ls.set = set; needClear = true; } },
    get activeSet() { return layerOf(0).set; },            // legacy single-layer read
    clearCompact(layer = 0) {
      for (let i = chunks.length - 1; i >= 0; i--) {
        const c = chunks[i];
        if (c._layer !== layer || c._set !== 'compact') continue;
        freeChunk(c);
        chunks.splice(i, 1);
      }
      const ls = layerOf(layer);
      if (ls.set === 'compact') { ls.set = 'base'; needClear = true; }
    },
    // points layers with a CATEGORY dict color class codes through the 256-wide
    // golden-angle palette instead of the 32-entry LAS classification table
    setLayerCats(layer, n) { const ls = layerOf(layer); if (ls.catN !== (n || 0)) { ls.catN = n || 0; cosmeticDirtyLayers.add(layer); } },
    // stick thickness (world meters) — a live per-layer knob
    setLayerStickRadius(layer, r) { const ls = layerOf(layer); const v = Math.max(0.05, +r || 1); if (ls.stickRadius !== v) { ls.stickRadius = v; needClear = true; } },
    layerStickRadius(layer) { return layerOf(layer).stickRadius; },
    // a points layer's size, as a multiple of the global point size (collar glyphs,
    // sparse samples) — drawn and picked at that size
    setLayerPointScale(layer, k) { const ls = layerOf(layer); const v = Math.max(0.25, Math.min(16, +k || 1)); if ((ls.pointScale || 1) !== v) { ls.pointScale = v === 1 ? undefined : v; needClear = true; } },
    layerPointScale(layer) { return layerOf(layer).pointScale || 1; },
    layerChanRange(layer) { const ls = layers.get(layer); return ls && (ls.chanTex && ls.chanTexRange || ls.docChan[0] !== Infinity) ? docRangeOf(ls) : null; },
    // per-layer section participation: an exempt layer draws (and picks) whole
    // while the others are slabbed — e.g. topo kept for context during sectioning
    setLayerSectioned(layer, mode) { const ls = layerOf(layer); const v = mode === undefined ? true : mode; if (ls.sectioned !== v) { ls.sectioned = v; needClear = true; } },
    layerSectioned(layer) { const m = layerOf(layer).sectioned; return m === undefined ? true : m; },
    
    // context-mesh style: tint [r,g,b] 0..1 + opacity 0..1 (Bayer screen-door)
    setLayerMeshStyle(layer, { tint, opacity } = {}) {
      const ls = layerOf(layer);
      if (tint) ls.meshTint = tint;
      if (opacity != null) ls.meshOpacity = Math.max(0.02, Math.min(1, +opacity));
      needClear = true;
    },
    layerMeshStyle(layer) { const ls = layerOf(layer); return { tint: ls.meshTint, opacity: ls.meshOpacity }; },
    // context-mesh per-vertex colours, live: rgb is Float32Array(3·vertexCount) for the
    // layer's (single) context chunk, or null to return to the tint; [lo, hi) is the
    // vertex range that changed. Painting sets on an outcrop rides this.
    setLayerMeshColors(layer, rgb, lo, hi) {
      let hit = false;
      for (const c of chunks) {
        if (c._layer !== layer || c.kind !== 'mesh') continue;
        meshPipe.setColor(c, rgb, lo, hi);
        hit = true;
      }
      if (hit) needClear = true;
      return hit;
    },
    // per-layer opacity for blocks (box impostors) + sticks (drillholes) — applied
    // as a screen-door dither in their shaders (see-through, no alpha-blend ordering).
    // Is this mesh layer PICKABLE? null = the default (opaque meshes pick, see-through
    // ones don't — you made it see-through to work on what is behind it). The app
    // overrides per layer: micro turns the ACTIVE mesh on, so selecting a surface in
    // the tree is what makes it clickable.
    setLayerPickable(layer, v) { layerOf(layer).meshPickable = v == null ? null : !!v; },
    layerPickable(layer) { const v = layerOf(layer).meshPickable; return v === undefined ? null : v; },
    setLayerOpacity(layer, opacity) { const ls = layerOf(layer); const v = Math.max(0.02, Math.min(1, +opacity)); ls.opacity = v; ls.meshOpacity = v; needClear = true; },   // ONE knob: mesh-family layers read meshOpacity
    // block-edge override: null = follow the draw-level blockEdges flag, true/false = force
    setLayerEdges(layer, v) { const ls = layerOf(layer); const nv = v == null ? null : !!v; if (ls.edges !== nv) { ls.edges = nv; needClear = true; } },
    layerEdges(layer) { const v = layerOf(layer).edges; return v === undefined ? null : v; },
    layerOpacity(layer) { return layerOf(layer).opacity; },
    // per-layer SELECTION bitmask (spec §15): same texture shape as the filter
    // mask; selected elements get a warm tint in every element program
    setLayerSelection(layer, mask) {
      const ls = layerOf(layer);
      if (!mask) {
        if (ls.selTex) { gl.deleteTexture(ls.selTex); ls.selTex = null; ls.selH = 0; }
      } else {
        recordTexture(ls, 'selTex', 'selH', mask, true, 'selection');
      }
      cosmeticDirtyLayers.add(layer);                                // a wash, not a cull — re-shade path
    },
    // per-layer RULE CODES (spec §10.4): one byte per record — which styling
    // rule claimed it (0 = none/else, 1..255 = rule order). Same texture shape
    // as the filter mask, but the byte is a VALUE, not a bit: in rule mode it
    // substitutes for the class code, so the palette, the per-class eyes, and
    // pick culling all compose without new machinery.
    setLayerRuleCodes(layer, codes) {
      const ls = layerOf(layer);
      if (!codes) {
        if (ls.ruleTex) { gl.deleteTexture(ls.ruleTex); ls.ruleTex = null; ls.ruleH = 0; }
      } else {
        recordTexture(ls, 'ruleTex', 'ruleH', codes, false, 'rule codes');
      }
      // rule codes recolor (cosmetic) — but when class EYES are active they
      // also re-CULL through catVis, which the captured id buffer can't follow
      if (ls.ruleOn && ls.catVisTex) needClear = true; else cosmeticDirtyLayers.add(layer);
    },
    // rule mode on/off per layer — kept separate from the codes so switching
    // categorized ⇄ rule-based is a flag flip, no re-upload
    setLayerRuleMode(layer, on) {
      const ls = layerOf(layer);
      if (ls.ruleOn !== !!on) {
        ls.ruleOn = !!on;
        if (ls.catVisTex) needClear = true; else cosmeticDirtyLayers.add(layer);   // eyes re-index on the flip
      }
    },
    // per-layer CATEGORY palette (legend colors/groups baked app-side).
    // pixels = Uint8Array(width*4) RGBA (width 256 for dict layers, 32 for LAS
    // classification — it must match what uPaletteN samples), null = built-ins.
    setLayerPalette(layer, pixels, width = 256) {
      const ls = layerOf(layer);
      if (!pixels) {
        if (ls.paletteTex) { gl.deleteTexture(ls.paletteTex); ls.paletteTex = null; ls.paletteW = 0; }
      } else if (!ls.paletteTex || ls.paletteW !== width) {
        if (ls.paletteTex) gl.deleteTexture(ls.paletteTex);
        ls.paletteTex = lutTexture(gl, pixels, width);
        ls.paletteW = width;
      } else {
        gl.bindTexture(gl.TEXTURE_2D, ls.paletteTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
      lutDirtyLayers.add(layer);                                     // a colour LUT: re-shade (or, projected, re-composite)
    },
    // a CODE layer whose codes are a NUMERIC scale (a ƒ / painted column: code 1..255
    // rises with the value, 0 = blank) — under a projection it projects its code and
    // composites back through its palette. Off: codes are classes (no maximum).
    setLayerProjectCodes(layer, on) {
      const ls = layerOf(layer);
      if (ls.projCodes !== !!on) { ls.projCodes = !!on; if (lastMip) needClear = true; }
    },
    // per-layer color ramp LUT (layer properties: presets + baked breakpoints).
    // pixels = Uint8Array(256*4) RGBA, or null to fall back to the built-in ramp.
    // OPT-IN: drive block color from an R32F VALUE texture (one texel per record,
    // 8192-wide rows) instead of the baked aChan buffer. `range` = [lo, hi] for the
    // ramp normalization — a computed texture has no docChan of its own. Pass a
    // null texture to fall back to aChan. The caller OWNS the texture (create,
    // render into, delete); the renderer only samples it.
    // what a BLANK value draws as (chan.js): [r, g, b, a] 0..1 — a < 0.5 hides blanks — or null
    // for the old picture (a blank clamps to the lowest ramp colour). A change in whether blanks
    // show re-rasters (they cull); a colour change re-shades.
    setLayerNoData(layer, rgba) {
      const ls = layerOf(layer);
      const next = rgba ? [+rgba[0], +rgba[1], +rgba[2], rgba[3] == null ? 1 : +rgba[3]] : null;
      const prev = ls.noData;
      if (JSON.stringify(prev) === JSON.stringify(next)) return;
      ls.noData = next;
      const shown = (v) => !v || v[3] >= 0.5;
      if (!prev !== !next || shown(prev) !== shown(next)) { needClear = true; dropCapture(); } else cosmeticDirtyLayers.add(layer);
    },
    // what a layer hides or recolours by VALUE (introspection for hosts and tests)
    // LIGHTWEIGHT (a software rasterizer — the host decides): the optional passes that cost a
    // full-screen neighbourhood read stand down — a ghost OUTLINE draws as the flat tint
    setLightweight(on) { if (lightweight !== !!on) { lightweight = !!on; needClear = true; } },
    get lightweight() { return lightweight; },
    // LOG TRACKS on a drillhole (sticks) layer (gl-logs.js): value ribbons beside each hole, as
    // many as you like — tracks = [{ values: Float32Array by record (NaN = blank), kind 'bar' |
    // 'strip', side 'left' | 'right' | 'center', offset, width (world), range [lo, hi], color
    // [r, g, b], ramp | palette: Uint8Array(256·4) | null }], or null / [] for none
    setLayerLogs(layer, tracks) {
      if (!logsPipe && (!tracks || !tracks.length)) return;
      if (!logsPipe) logsPipe = createLogsPipeline(gl);
      logsPipe.set(layer, tracks);
      needClear = true;
    },
    layerLogs(layer) { return logsPipe && logsPipe.has(layer) ? { reach: logsPipe.reach(layer) } : null; },
    layerGhost(layer) { const ls = layers.get(layer); return ls && ls.ghost ? { style: ls.ghost, color: ls.ghostColor ? ls.ghostColor.slice() : null } : null; },
    layerValueState(layer) { const ls = layers.get(layer); return ls ? { noData: ls.noData ? ls.noData.slice() : null, rampHides: !!ls.rampHides } : null; },
    setLayerChanTex(layer, tex, range = null) {
      const ls = layerOf(layer);
      const nr = (tex && range) ? [range[0], Math.max(1e-9, range[1] - range[0])] : null;
      const same = ls.chanTex === (tex || null) && JSON.stringify(ls.chanTexRange) === JSON.stringify(nr);
      ls.chanTex = tex || null;
      ls.chanTexRange = nr;
      if (!same) cosmeticDirtyLayers.add(layer);               // the same texture handed back (a ramp re-apply) changes nothing
    },
    // opts.nearest: sample the LUT texel-exact — a CLASSED ramp, whose colours must not blend at
    // a class boundary into a colour no legend shows (LINEAR suits a continuous ramp)
    setLayerRamp(layer, pixels, opts = {}) {
      const ls = layerOf(layer);
      // texels with alpha 0 HIDE their values (a class's eye): a change in WHICH texels hide is
      // a visibility change — geometry culls, so it re-rasters; a colour change re-shades
      let sig = '';
      if (pixels) for (let i = 0; i < 256; i++) if (pixels[i * 4 + 3] < 128) sig += i + ',';
      if (sig !== ls.rampAlphaSig) { ls.rampAlphaSig = sig; ls.rampHides = !!sig; needClear = true; dropCapture(); }
      if (!pixels) {
        if (ls.rampTex) { gl.deleteTexture(ls.rampTex); ls.rampTex = null; }
      } else if (!ls.rampTex) {
        ls.rampTex = lutTexture(gl, pixels, 256);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, ls.rampTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
      if (ls.rampTex) {
        const f = opts.nearest ? gl.NEAREST : gl.LINEAR;
        gl.bindTexture(gl.TEXTURE_2D, ls.rampTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      }
      lutDirtyLayers.add(layer);                                     // a colour LUT: re-shade (or, projected, re-composite)
    },
    // per-CLASS visibility (layer properties): vis = Uint8Array(256) of 0|1, or
    // null to clear. GPU-side — the class code already rides every element as
    // an attribute, so eyes are a texture update: no sweeps, any element count.
    // Composes with the filter mask (both are cull paths); hidden classes
    // don't pick either (gl-pick reads the same texture).
    setLayerCatVisibility(layer, vis) {
      const ls = layerOf(layer);
      if (!vis) {
        if (ls.catVisTex) { gl.deleteTexture(ls.catVisTex); ls.catVisTex = null; }
      } else {
        const px = new Uint8Array(256);
        for (let i = 0; i < 256; i++) px[i] = vis[i] ? 255 : 0;
        if (!ls.catVisTex) {
          ls.catVisTex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, ls.catVisTex);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, px);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, ls.catVisTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, px);
        }
      }
      needClear = true;
    },
    setLayerVisible(layer, on) {
      const ls = layerOf(layer);
      if (ls.visible !== !!on) { ls.visible = !!on; needClear = true; }
    },
    // Translate a layer at DRAW time: [dx, dy, dz] in frame-local units (the
    // frame's units — metres for a metric CRS); [0,0,0] or null clears it. No
    // re-upload, no chunk rebuild: the offset is folded into the camera the
    // layer is drawn and picked with, so every pipeline (points, blocks, sticks,
    // meshes, soups), the section (it cuts the displaced geometry), culling, the
    // deferred re-shade and the ID buffer agree. DISPLAY ONLY: records keep
    // their true coordinates, elevation colouring reads the true z, and pick()
    // returns record identities, so nothing the host reads back is displaced.
    setLayerOffset(layer, o) {
      const ls = layerOf(layer);
      const v = o && (o[0] || o[1] || o[2]) ? [+o[0] || 0, +o[1] || 0, +o[2] || 0] : null;
      const cur = ls.offset;
      if (!v && !cur) return;
      if (v && cur && v[0] === cur[0] && v[1] === cur[1] && v[2] === cur[2]) return;
      ls.offset = v;
      needClear = true;                                    // moves pixels: re-raster (and drop the id capture)
    },
    layerOffset(layer) { const ls = layers.get(layer); return ls && ls.offset ? [...ls.offset] : [0, 0, 0]; },
    // the frame-local bbox of what is drawn — every visible layer's chunks with
    // their offsets applied (sticks padded by their radius) — for fit-to-view on
    // an exploded scene. null when nothing is visible.
    contentBbox({ layers: only = null } = {}) {
      const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      const tmp = new Float64Array(6);
      for (const c of chunks) {
        if (!activeChunk(c) || (only && !only.includes(c._layer))) continue;
        const b = drawnBox(c, tmp);
        const r = c.kind === 'sticks' ? layerOf(c._layer).stickRadius : 0;
        for (let i = 0; i < 3; i++) { out[i] = Math.min(out[i], b[i] - r); out[i + 3] = Math.max(out[i + 3], b[i + 3] + r); }
      }
      return out[0] === Infinity ? null : Float64Array.from(out);
    },
    removeLayer(layer) {
      for (let i = chunks.length - 1; i >= 0; i--) {
        const c = chunks[i];
        // its own chunks, or (a source going) its views' proxies of them
        if (c._layer !== layer && !(c._src && c._src._layer === layer)) continue;
        freeChunk(c);                                      // a proxy frees nothing
        chunks.splice(i, 1);
      }
      viewSrc.delete(layer);                               // a view going: its link goes with it
      // a source going: its views keep their link and state (a re-stream re-adds
      // chunks under the same id and they re-proxy), but no longer its data
      for (const [v, s] of viewSrc) if (s === layer) { const vs = layers.get(v); if (vs) { vs.docChan = [Infinity, -Infinity]; vs.intensityMax = 1; } layerMaxRec.set(v, 0); }
      const ls = layers.get(layer);
      if (ls && ls.maskTex) gl.deleteTexture(ls.maskTex);
      if (ls && ls.catVisTex) gl.deleteTexture(ls.catVisTex);
      if (ls && ls.rampTex) gl.deleteTexture(ls.rampTex);
      if (ls && ls.paletteTex) gl.deleteTexture(ls.paletteTex);
      if (ls && ls.selTex) gl.deleteTexture(ls.selTex);
      if (ls && ls.ruleTex) gl.deleteTexture(ls.ruleTex);
      layers.delete(layer);
      if (resolvePipe) resolvePipe.dropBake(layer);
      if (mipPipe) mipPipe.drop(layer);
      if (ghostPipe) ghostPipe.drop(layer);
      if (logsPipe) logsPipe.drop(layer);
      layerMaxRec.delete(layer); bakeDirty.delete(layer);
      lastCosSig.delete(layer); cosmeticDirtyLayers.delete(layer); lutDirtyLayers.delete(layer);
      needClear = true;
    },
    // drop a layer's own chunks (optionally only those of `kinds`, e.g. ['mesh']) but KEEP
    // its state — filter mask, selection, categories, ramp, stick radius, mesh style. For a
    // layer whose geometry is rebuilt in place from resident data (an edited polygon layer,
    // a fill toggled on and off); removeLayer is for a layer going away.
    clearLayerChunks(layer, kinds = null) {
      for (let i = chunks.length - 1; i >= 0; i--) {
        const c = chunks[i];
        if (c._layer !== layer || c._src) continue;
        if (kinds && !kinds.includes(c.kind)) continue;
        freeChunk(c);
        chunks.splice(i, 1);
      }
      const ls = layers.get(layer);
      if (ls && (!kinds || kinds.includes('sticks') || kinds.includes('blocks'))) ls.docChan = [Infinity, -Infinity];
      dropCapture();
      needClear = true;
    },
    layerElementCount(layer) {
      const ls = layers.get(layer);
      if (!ls) return 0;
      return chunks.reduce((s, c) => s + (c._layer === layer && c._set === ls.set ? c.count : 0), 0);
    },
    invalidate() { needClear = true; },
    // Pick/unpick over a CONVERGED frame repaints just the affected elements
    // (a depth-LEQUAL pass where everything else clips out) instead of
    // restarting the accumulation — same total vertex work, none of the
    // de-densify blink. Mid-accumulation falls back to the clear.
    // { layer, rec } — or null for "nothing picked". The pair IS the identity:
    // record 5 of layer 2 and record 5 of layer 3 are different elements.
    setPicked(pick) {
      const next = pick == null ? 0xFFFFFFFF : (pick.rec >>> 0);
      const nextL = pick == null ? 0xFFFFFFFF : (pick.layer >>> 0);
      if (next === pickedRec && nextL === pickedLayer) return;
      const prev = pickedRec;
      pickedRec = next; pickedLayer = nextL;
      if (lastConverged && !needClear) {
        if (prev !== 0xFFFFFFFF) repaintSet.add(prev);
        if (next !== 0xFFFFFFFF) repaintSet.add(next);
        if (repaintSet.size > 2) { repaintSet.clear(); needClear = true; }   // rapid multi-pick: one redraw is cheaper
      } else needClear = true;
    },
    // GPU pick at CSS coordinates → PARTITIONED record id | null. Draws each
    // visible layer's accumulated prefix into a scissored offscreen target with
    // the record id as the color (gl-pick.js) — you pick exactly what you see.
    // marquee/lasso support (spec §15): render the ID buffer once over a CSS
    // rect and hand back the raw pixels — the app polygon-masks and decodes.
    pickRegion(cssRect, cam, { pointPx = 2.5, blocksAsPoints = false, section = null } = {}) {
      if (!chunks.length) return null;
      if (!pickPipe) pickPipe = createPickPipeline(gl);
      const dpr = backingRatio(canvas);
      const x = Math.max(0, Math.round(cssRect.x * dpr));
      const yTop = Math.round(cssRect.y * dpr);
      const w = Math.min(canvas.width - x, Math.round(cssRect.w * dpr));
      const h = Math.min(canvas.height, Math.round(cssRect.h * dpr));
      const y = Math.max(0, canvas.height - yTop - h);
      if (w <= 0 || h <= 0) return null;
      const sec = section && section.on ? section : null, key = capKey(cam, pointPx, blocksAsPoints, sec);
      // under a PROJECTION a marquee / lasso takes the records the picture shows: where a
      // projected layer composited, the record that IS the pixel's value (max / min: the
      // highest / lowest; mean: the one nearest the pixel's mean, keyed per pixel from the
      // projection's own target); elsewhere the scene's front surface, as usual
      if (lastMip && mipPipe && lastMip.w === canvas.width && lastMip.h === canvas.height) {
        const pOpts = { pointPx, blocksAsPoints, layerStates: layers, section: sec, viewportW: canvas.width, viewportH: canvas.height };
        const data = pickPipe.pickRegion(x, y, w, h, chunks.filter((c) => activeChunk(c) && !lastMip.layers.includes(c._layer)), cam, pOpts);
        const refTex = lastMip.mode === 'mean' ? (id) => { const t = mipPipe.target(id); return t ? t.tex : null; } : null;
        for (const id of lastMip.layers) {                   // composite order: a later layer's pixel wins, as on screen
          const d = pickPipe.pickRegion(x, y, w, h, chunks.filter((c) => activeChunk(c) && c._layer === id), cam, { ...pOpts, mip: { mode: lastMip.mode, ref: 0, refTex } });
          for (let i = 0; i < w * h; i++) if (d[i * 4 + 1] !== pickPipe.NO_LAYER) { data[i * 4] = d[i * 4]; data[i * 4 + 1] = d[i * 4 + 1]; }
        }
        gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, null);
        return { data, w, h, dpr, projection: lastMip.mode };
      }
      if (capReady(key)) { pickFromCapture++; return { data: pickPipe.readCaptured(x, y, w, h), w, h, dpr }; }
      if (idCapture && idCapture.key !== key) dropCapture();   // the scissored pass below draws into the same target
      const data = pickPipe.pickRegion(x, y, w, h, chunks.filter(activeChunk), cam, {
        pointPx, blocksAsPoints, layerStates: layers, section: sec,
        viewportW: canvas.width, viewportH: canvas.height,
      });
      return { data, w, h, dpr };                          // rows bottom-up (GL), NO_HIT = 0xFFFFFFFF
    },
    // IDLE WORK: build the converged frame's id buffer a batch of chunks per call
    // (the app calls it each idle frame until it says done). With it complete, a
    // pick or a marquee just READS it: a click on a 60M-block model no longer
    // runs the vertex stage over every block while the page waits. Any change —
    // the camera, the geometry, a re-raster — throws the capture away and the
    // next idle frames rebuild it. → true when there is nothing (more) to do.
    idleCapture(cam, { pointPx = 2.5, blocksAsPoints = false, section = null, budget = 3_000_000 } = {}) {
      if (!chunks.length || !lastConverged || needClear || lastMip) return true;
      if (!pickPipe) pickPipe = createPickPipeline(gl);
      const sec = section && section.on ? section : null, key = capKey(cam, pointPx, blocksAsPoints, sec);
      if (idCapture && idCapture.complete && idCapture.key === key && idCapture.w === canvas.width && idCapture.h === canvas.height) {   // complete — done once the GPU has caught up with it
        if (!idCapture.fence) return true;
        const st = gl.getSyncParameter(idCapture.fence, gl.SYNC_STATUS);
        if (st !== gl.SIGNALED) return false;
        gl.deleteSync(idCapture.fence); idCapture.fence = null; return true;
      }
      if (!idCapture || idCapture.key !== key || idCapture.w !== canvas.width || idCapture.h !== canvas.height) {
        dropCapture();
        idCapture = { key, complete: false, list: chunks.filter(activeChunk), next: 0, tex: null, depth: null, w: canvas.width, h: canvas.height };
        pickPipe.beginCapture(canvas.width, canvas.height);
      }
      const batch = []; let n = 0;
      while (idCapture.next < idCapture.list.length && (n < budget || !batch.length)) { const c = idCapture.list[idCapture.next++]; batch.push(c); n += c.count || 0; }
      const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const r = pickPipe.captureMore(batch, cam, { pointPx, blocksAsPoints, layerStates: layers, section: sec, viewportW: canvas.width, viewportH: canvas.height });
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (idCapture.next >= idCapture.list.length) Object.assign(idCapture, { complete: true, tex: r.tex, depth: r.depth, list: null, fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) });
      return false;                                        // the next call waits for the fence
    },
    get captureReady() { return !needClear && !!(idCapture && idCapture.complete && !idCapture.fence); },
    get picksFromCapture() { return pickFromCapture; },
    pick(cssX, cssY, cam, { pointPx = 2.5, blocksAsPoints = false, section = null } = {}) {
      if (!chunks.length) return null;
      if (!pickPipe) pickPipe = createPickPipeline(gl);
      const dpr = backingRatio(canvas);
      const px = Math.round(cssX * dpr), py = Math.round(canvas.height - cssY * dpr - 1);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
      const sec = section && section.on ? section : null, key = capKey(cam, pointPx, blocksAsPoints, sec);
      // a PROJECTION names the record that IS the pixel's value (gl-mip.js): the
      // projected layer whose colour shows here (the last one composited that hit
      // it), drawn once more with depth = how far each record's value is from the
      // pixel's (max: 1 − t, min: t, mean: |t − mean|) — the depth test keeps the
      // one the picture shows, exactly, with no float equality anywhere
      if (lastMip && mipPipe && lastMip.w === canvas.width && lastMip.h === canvas.height) {   // (a figure render resized the canvas: until the next frame, no projection to read)
        const pOpts = { pointPx, blocksAsPoints, layerStates: layers, section: sec, viewportW: canvas.width, viewportH: canvas.height };
        for (const id of [...lastMip.layers].reverse()) {
          const r = mipPipe.read(id, px, py, 1, 1);
          const t = r ? r.data[0] : NaN;
          if (!(t === t)) continue;                          // nothing projected here on this layer
          const hit = pickPipe.pick(px, py, chunks.filter((c) => activeChunk(c) && c._layer === id), cam, { ...pOpts, mip: { mode: lastMip.mode, ref: t } });
          if (hit) return { ...hit, projection: { mode: lastMip.mode, t } };
        }
        // no projection under the cursor: the rest of the scene, as usual
        return pickPipe.pick(px, py, chunks.filter((c) => activeChunk(c) && !lastMip.layers.includes(c._layer)), cam, pOpts);
      }
      if (capReady(key)) {                                 // the still frame's id buffer is complete: read it, no render
        pickFromCapture++;
        const o = pickPipe.readCaptured(px, py, 1, 1);
        if (o[1] === pickPipe.NO_LAYER) return null;
        const g = o[1] >>> 0;
        return { layer: g & 0xFFFF, rec: o[0] >>> 0, face: (g >>> 16) & 7 };
      }
      if (idCapture && idCapture.key !== key) dropCapture();
      return pickPipe.pick(px, py, chunks.filter(activeChunk), cam, {
        pointPx, blocksAsPoints, layerStates: layers, section: sec,
        viewportW: canvas.width, viewportH: canvas.height,
      });
    },
    clearChunks() {
      for (const c of chunks) freeChunk(c);
      chunks.length = 0; needClear = true;
      for (const ls of layers.values()) { if (ls.maskTex) gl.deleteTexture(ls.maskTex); if (ls.catVisTex) gl.deleteTexture(ls.catVisTex); if (ls.rampTex) gl.deleteTexture(ls.rampTex); if (ls.paletteTex) gl.deleteTexture(ls.paletteTex); if (ls.selTex) gl.deleteTexture(ls.selTex); if (ls.ruleTex) gl.deleteTexture(ls.ruleTex); }
      layers.clear(); viewSrc.clear();
      if (resolvePipe) resolvePipe.clear();
      if (mipPipe) mipPipe.clear();
      if (ghostPipe) ghostPipe.clear();
      if (logsPipe) logsPipe.clear();
      lastMip = null; lastMipKey = '';
      layerMaxRec.clear(); bakeDirty.clear(); dropCapture();
      lastCosSig.clear(); cosmeticDirtyLayers.clear(); lutDirtyLayers.clear();
    },
    // cap the backing ratio (Infinity = the device's own). A phone at DPR 2.8 fills
    // ~2× the pixels of DPR 2 for no visible gain; the next resize() applies it.
    setMaxPixelRatio(r) { maxPixelRatio = r > 0 ? r : Infinity; },
    get maxPixelRatio() { return maxPixelRatio; },
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, maxPixelRatio);   // the cap — every other site reads the ratio back from the canvas
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; needClear = true; }
      return [w, h];
    },
    // Draw one frame into the CURRENT framebuffer (the EDL pass owns the target).
    // opts.layerOpts = { [id]: { colorMode, clip } } overrides the global color
    // opts per layer (absent → the globals, so single-layer callers are unchanged).
    // Returns { drawn, converged, visible }.
    // opts.projection: 'max' | 'min' | 'mean' | null — the PROJECTION mode (gl-mip.js):
    // every visible blocks/points layer coloured by a VALUE (colour mode 1) draws as
    // the per-pixel max / min / mean of its normalized values along the line of
    // sight, occlusion ignored; everything else draws as usual underneath. The
    // result's `projection` says which layers and how much of them has been drawn
    // ({ mode, layers, drawn, total, exact }) — approximate until exact.
    draw(cam, { budget = 3_000_000, pointPx = 2.5, colorMode = 0, blocksAsPoints = false, blockEdges = false, section = null, clip = null, layerOpts = null, projection = null } = {}) {
      const vp = cam.state.viewProj;
      const camMemo = new Map();
      const camOf = (id) => camFor(cam, id, camMemo);      // a moved layer's camera (setLayerOffset)
      const sec = section && section.on ? section : null;
      const secKey = sec ? `${sec.n.join(',')}|${sec.d}|${sec.half}` : 'off';
      const mipMode = PROJECTION_MODES.includes(projection) ? projection : null;
      // the old single draw key, SPLIT: structural changes re-raster; cosmetic
      // ones (color mode, clip, per-layer view opts — plus whatever the
      // cosmetic setters touched) can deferred-re-shade over the converged frame
      const structKey = `${pointPx}|${blocksAsPoints ? 'P' : 'B'}${blockEdges ? 'E' : ''}|${secKey}|${canvas.width}x${canvas.height}${mipMode ? '|' + mipMode : ''}`;
      let moving = vpChanged(vp) || structKey !== lastKey || needClear;

      const db = docBbox || Float64Array.of(0, 0, 0, 1, 1, 1);
      // per-layer view opts (color mode + clip); the globals when not overridden
      const lopt = (id) => (layerOpts && layerOpts[id]) || { colorMode, clip };
      // elevation ramp = the SCENE z range (layers share vertical space) + clip
      const zRangeOf = (o) => {
        const zLo = o.clip && o.clip[0] != null && o.colorMode === 0 ? o.clip[0] : db[2];
        const zHi = o.clip && o.clip[1] != null && o.colorMode === 0 ? o.clip[1] : db[5];
        return [zLo, Math.max(zHi - zLo, 1e-6)];
      };

      // per-layer cosmetic DIRT: explicit setter dirt + drift in the view opts
      // this layer's raster consumed (color mode + clip, global or per-layer).
      // Hidden layers can't change pixels; meshes ignore color opts entirely
      // (their cosmetics go through setLayerMeshStyle → needClear).
      const sigOf = (id) => { const o = lopt(id); return `${o.colorMode}|${o.clip ? `${o.clip[0]}~${o.clip[1]}` : 'a'}`; };
      // what a layer projects: 'chan' (its value, colour mode 1) · 'codes' (a numeric code scale) · null
      const projOf = (id) => {
        const o = lopt(id); if (o.colorMode === 1) return 'chan';
        const ls = layers.get(id);
        return o.colorMode === 2 && ls && ls.projCodes && ls.ruleOn && ls.ruleTex ? 'codes' : null;
      };
      const kindBy = new Map(), subBy = new Set();
      for (const c of chunks) if (activeChunk(c)) {
        if (!kindBy.has(c._layer)) kindBy.set(c._layer, c.kind);
        if (c.sub) subBy.add(c._layer);                    // sub-blocked: variable half-dims
      }
      // the layers this frame PROJECTS: blocks/points coloured by a value — or by the codes of a
      // numeric ƒ / painted column (setLayerProjectCodes) — when the GPU offers the mode
      const mipIds = new Set();
      if (mipMode) {
        if (!mipPipe) mipPipe = createMipPipeline(gl);
        if (mipPipe.supports(mipMode)) for (const [id, k] of kindBy) if ((k === 'blocks' || k === 'points') && projOf(id)) mipIds.add(id);
      }
      const dirty = new Set(cosmeticDirtyLayers);
      // a ramp / palette change on a PROJECTED layer only re-composites (every frame does):
      // its target holds values, not colours — no re-raster, nothing redrawn
      for (const id of lutDirtyLayers) if (!mipIds.has(id)) dirty.add(id);
      // a layer with no signature yet was never rasterized: its chunks DRAW (cursor 0, into the
      // accumulation) — it is not a cosmetic change to re-shade, and treating it as one returned a
      // converged frame without its first chunk (a streamed layer arriving piece by piece)
      for (const id of kindBy.keys()) if (lastCosSig.has(id) && lastCosSig.get(id) !== sigOf(id)) dirty.add(id);
      for (const id of [...dirty]) { const k = kindBy.get(id); if (!k || k === 'mesh') dirty.delete(id); }
      // a layer entering or leaving the projection changes what every pixel it covers
      // means (a projected pixel isn't its front surface): start the frame over
      // the GHOST layers (gl-ghost.js): a filtered blocks / points layer shown as ghost (not projected)
      const ghostIds = new Set();
      for (const [id, k] of kindBy) { const ls = layers.get(id); if (ls && ls.ghost && ls.maskTex && (k === 'blocks' || k === 'points') && !mipIds.has(id)) ghostIds.add(id); }
      const ghostSlices = ghostIds.size ? [] : null;         // [chunk, first, k] the raster drew of a ghost layer — the ghost pass draws them too
      const mipKey = [...mipIds].join(',');
      if (mipKey !== lastMipKey) { moving = true; lastMipKey = mipKey; }

      // ── DEFERRED RE-SHADE (gl-resolve.js): cosmetic changes over a CONVERGED
      // frame become one fullscreen resolve pass per DIRTY layer — O(pixels) at
      // any model size. Untouched layers (a drillhole sticks layer while the
      // block ramp drags) keep their accumulated pixels; only a change to a
      // layer the id buffer can't express (sticks/soup recolor, culling,
      // opacity, edges) falls through to the re-raster. ──
      // (not under a projection: the id buffer is the FRONT surface, a projection's pixel isn't)
      if (!moving && dirty.size && lastConverged && !mipIds.size) {
        if (!resolvePipe) resolvePipe = createResolvePipeline(gl);
        resolveOk: if (resolvePipe.ok) {
          let bail = false;
          const groups = new Map();
          for (const id of dirty) {
            const ls = layerOf(id), k = kindBy.get(id);
            if (k !== 'points' && k !== 'blocks') { bail = true; break; }   // a sticks/soup recolor must re-raster
            if (ls.opacity < 0.999) { bail = true; break; }   // screen-door holes aren't in the id buffer
            // edge lines RESOLVE for regular grids (the capture depth unprojects
            // the hit point, the lattice snaps the center); sub-blocked models
            // have per-block half-dims the depth alone can't recover
            if (k === 'blocks' && (ls.edges != null ? ls.edges : blockEdges) && subBy.has(id)) { bail = true; break; }
            // a ROTATED model's face ids name lattice faces: the resolve shades them by
            // R·n and reconstructs edge lines in the lattice frame (gl-resolve rotEdge)
            groups.set(id, []);
            // NOTE: isolate filters and class eyes (catVis) are FINE here even
            // though they cull — changing them goes through needClear, so at
            // this point they are unchanged since the capture and the id
            // buffer already reflects the culled geometry.
          }
          if (bail || !groups.size) break resolveOk;
          const act = chunks.filter(activeChunk);
          for (const c of act) { const g = groups.get(c._layer); if (g) g.push(c); }
          // capture the id buffer LAZILY — ids don't depend on cosmetics, so the
          // pre-change converged geometry still yields the correct capture; a
          // still scene that never gets a cosmetic poke never pays for one
          if (!pickPipe) pickPipe = createPickPipeline(gl);
          const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
          const ck = capKey(cam, pointPx, blocksAsPoints, sec);
          if (!capReady(ck)) {
            dropCapture();
            idCapture = { ...pickPipe.captureViewport(act, cam, {
              pointPx, blocksAsPoints, layerStates: layers,
              section: sec, viewportW: canvas.width, viewportH: canvas.height,
            }), key: ck, complete: true };
          }
          for (const [id, group] of groups) {              // (re)bake stale attr textures
            if (!resolvePipe.hasBake(id) || bakeDirty.has(id)) {
              resolvePipe.bakeLayer(id, group, layerMaxRec.get(id) || 0);
              bakeDirty.delete(id);
            }
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);     // back to the EDL target
          gl.viewport(0, 0, canvas.width, canvas.height);
          // a layer whose bake couldn't exist (past MAX_TEXTURE_SIZE, out of video
          // memory) has nothing to resolve from: the frame re-rasters instead
          for (const id of groups.keys()) if (!resolvePipe.hasBake(id)) break resolveOk;
          for (const [id, group] of groups) {
            // the layer's own camera: an offset layer unprojects into ITS
            // coordinates, so the lattice snap and the cut-wall side stay exact
            const s = camOf(id).state, v = s.view;
            // headlight — the exact formula blocksPipe.begin computes
            let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
            const ll = Math.hypot(lx, ly, lz) || 1;
            lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
            const l2 = Math.hypot(lx, ly, lz) || 1;
            const lightDir = [lx / l2, ly / l2, lz / l2];
            const invVP = mat4Inverse(s.viewProj);         // edge-line unproject
            const perspScale = s.ortho ? (canvas.height / 2) / s.halfH : (canvas.height / 2) / Math.tan(s.fovY / 2);
            const ls = layerOf(id), o = lopt(id), zr = zRangeOf(o);
            let u;
            if (group[0].kind === 'blocks') {
              // the cut wall faces the viewer: the section normal signed toward the eye
              const lsec = layerSecOf(ls, sec);
              let cutN = [0, 0, 1];
              if (lsec) {
                const sgn = Math.sign(s.eye[0] * lsec.n[0] + s.eye[1] * lsec.n[1] + s.eye[2] * lsec.n[2] - lsec.d) || 1;
                cutN = [lsec.n[0] * sgn, lsec.n[1] * sgn, lsec.n[2] * sgn];
              }
              u = {
                kind: 'blocks', colorMode: o.colorMode, zRange: zr,
                chanDoc: chanDocOf(ls, o),
                paletteN: 256, intensityScale: 1,
                ramp: ls.rampTex || ramp, palette: ls.paletteTex || catPalette || palette,
                mask: ls.maskTex, sel: ls.selTex, rule: ls.ruleOn ? ls.ruleTex : null, chanTex: ls.chanTex, noData: ls.noData,
                picked: pickedRec, pickedLayer, lightDir, cutNormal: cutN,
                edges: ls.edges != null ? ls.edges : blockEdges, depth: idCapture.depth,
                invVP, viewportW: canvas.width, viewportH: canvas.height,
                eye: [s.eye[0], s.eye[1], s.eye[2]], ortho: s.ortho, perspScale,
                grid: group[0].grid,
              };
            } else {
              u = {
                kind: 'points', colorMode: o.colorMode, zRange: zr, chanDoc: chanDocOf(ls, o),
                paletteN: ls.paletteTex ? ls.paletteW : (ls.catN || 32),
                intensityScale: 65535 / (ls.intensityMax || 1),
                ramp: ls.rampTex || ramp, palette: ls.paletteTex || (ls.catN && catPalette ? catPalette : palette),
                mask: ls.maskTex, sel: ls.selTex, rule: ls.ruleOn ? ls.ruleTex : null, chanTex: ls.chanTex, noData: ls.noData,
                picked: pickedRec, pickedLayer, lightDir: [0, 0, 1], cutNormal: [0, 0, 1],
              };
            }
            resolvePipe.resolveLayer(idCapture.tex, id, u);
          }
          resolves++;
          for (const id of kindBy.keys()) lastCosSig.set(id, sigOf(id));
          cosmeticDirtyLayers.clear(); lutDirtyLayers.clear();
          // repaintSet stays: a pending pick highlight on a NON-resolved layer
          // is repainted by the next still frame's repaint pass
          return { drawn: 0, converged: true, visible: lastVisible, resolved: true };
        }
      }
      if (dirty.size) moving = true;                       // no resolve → a cosmetic change re-rasters
      lastKey = structKey; needClear = false;
      for (const id of kindBy.keys()) lastCosSig.set(id, sigOf(id));
      cosmeticDirtyLayers.clear(); lutDirtyLayers.clear();
      if (moving) { repaintSet.clear(); dropCapture(); }   // full redraw covers pending repaint; the capture is stale

      // frustum-cull + front-to-back over chunk bboxes (tight, thanks to Morton)
      const planes = frustumPlanes(vp);
      const eye = cam.state.eye;
      const visible = [];
      const padBox = new Float64Array(6), movedBox = new Float64Array(6);
      for (const c of chunks) {
        if (!activeChunk(c)) continue;
        const b = drawnBox(c, movedBox);                   // where it's drawn (layer offset applied)
        let cullBox = b;
        if (c.kind === 'sticks') {
          const r = Math.max(layerOf(c._layer).stickRadius, logsPipe ? logsPipe.reach(c._layer) : 0);   // log ribbons reach past the stick
          for (let i = 0; i < 3; i++) { padBox[i] = b[i] - r; padBox[i + 3] = b[i + 3] + r; }
          cullBox = padBox;
        }
        if (!aabbInFrustum(planes, cullBox)) { if (moving) c.cursor = 0; continue; }
        const cx = (b[0] + b[3]) / 2 - eye[0], cy = (b[1] + b[4]) / 2 - eye[1], cz = (b[2] + b[5]) / 2 - eye[2];
        const dist = Math.max(Math.hypot(cx, cy, cz), cam.state.near);
        const r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 || 1;
        c._dist = dist;
        c._w = Math.min(1, (r / dist) * (r / dist));       // projected-area weight
        visible.push(c);
      }
      visible.sort((a, b) => a._dist - b._dist);           // front-to-back
      lastVisible = visible.length;
      const sumW = visible.reduce((s, c) => s + c._w, 0) || 1;

      // what the pick pass needs to cull by VALUE as this frame does (a hidden class, hidden blanks)
      for (const id of kindBy.keys()) {
        const ls0 = layerOf(id), o0 = lopt(id);
        ls0._valPick = { colorMode: o0.colorMode, zRange: zRangeOf(o0), chanDoc: chanDocOf(ls0, o0), intensityScale: 65535 / (ls0.intensityMax || 1) };
      }
      gl.enable(gl.DEPTH_TEST);
      if (moving) {
        gl.clearColor(background[0], background[1], background[2], background[3]);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | (ghostIds.size ? gl.STENCIL_BUFFER_BIT : 0));
        for (const c of visible) c.cursor = 0;
      }

      // this frame's allotment per chunk: budget share by projected weight, floored
      // so distant chunks keep a sparse presence (coarse prefix always on)
      const allot = (c) => {
        const share = Math.max(Math.min(c.count, 1000), Math.floor(budget * (c._w / sumW)));
        const first = moving ? 0 : c.cursor;
        return [first, Math.min(c.count - first, share)];
      };
      let drawn = 0, converged = true;
      // pending pick repaint: one extra full-geometry pass at depth LEQUAL —
      // lands exactly on the element's already-accumulated pixels
      const rp = !moving && repaintSet.size
        ? [...repaintSet, 0xFFFFFFFF, 0xFFFFFFFF].slice(0, 2).map((v) => v >>> 0) : null;

      // context meshes first: static occluders drawn WHOLE on clear frames (or
      // when freshly streamed in) — early-z then rejects points behind them.
      // On still frames their cursor == count, so accumulation skips them.
      const msh = visible.filter((c) => c.kind === 'mesh');
      if (msh.length) {
        for (const [id, group] of byLayer(msh)) {
          if (!group.some((c) => moving || c.cursor === 0)) continue;
          const ls = layerOf(id);
          meshPipe.begin(camOf(id), { tint: ls.meshTint, opacity: ls.meshOpacity, section: meshSecOf(ls, sec),
            vcolor: group.some((c) => c.hasColor), vnormal: group.some((c) => c.hasNormal) });   // heightfield drape + smooth normals
          for (const c of group) {
            if (!(moving || c.cursor === 0)) continue;
            meshPipe.draw(c);
            c.cursor = c.count;
            drawn += c.count;
          }
        }
        gl.bindVertexArray(null);
      }

      // streaming-tier meshes: budgeted prefixes like points (the shuffle makes
      // any prefix a uniform subsample of the soup), drawn before points so the
      // surface occludes early
      const soup = visible.filter((c) => c.kind === 'soup');
      if (soup.length) {
        for (const [id, group] of byLayer(soup)) {
          const ls = layerOf(id);
          soupPipe.begin(camOf(id), { tint: ls.meshTint, opacity: ls.meshOpacity, section: meshSecOf(ls, sec) });
          for (const c of group) {
            const [first, k] = allot(c);
            if (k > 0) {
              soupPipe.drawSlice(c, first, k);
              drawn += k; c.cursor = first + k;
            }
            if (c.cursor < c.count) converged = false;
          }
        }
        gl.bindVertexArray(null);
      }

      // PROJECTED layers (gl-mip.js) leave the raster: they draw into their own
      // targets after it, and composite over it
      const isMip = (c) => mipIds.has(c._layer);
      // the points program's per-frame state (the raster's, or the projection's)
      const ptsFrame = (P) => {
        uni = P.uni;
        gl.useProgram(P.prog);
        gl.uniformMatrix4fv(uni.viewProj, false, vp);
        gl.uniform1f(uni.pointPx, pointPx * backingRatio(canvas));
        gl.uniform1ui(uni.picked, pickedRec);
        gl.uniform1ui(uni.pickedLayer, pickedLayer);
        gl.uniform2ui(uni.repaint, 0xFFFFFFFF, 0xFFFFFFFF);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ramp); gl.uniform1i(uni.ramp, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, palette); gl.uniform1i(uni.palette, 1);
      };
      const pts = visible.filter((c) => c.kind === 'points' && !isMip(c));
      // under a GHOST, every element drawn marks the stencil 1 — a ghost never covers a kept
      // element (meshes and soups above stay unmarked: a ghost in front of a surface shows)
      if (ghostIds.size) { gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); gl.stencilMask(0xff); }
      // per-layer uniforms (reads `uni`: whichever program ptsFrame set up)
      const setupPtsLayer = (id) => {
          const ls = layerOf(id), o = lopt(id), zr = zRangeOf(o);
          gl.uniform1ui(uni.layer, id >>> 0);
          gl.uniform1f(uni.pointPx, pointPx * backingRatio(canvas) * (ls.pointScale || 1));   // a per-layer glyph size
          gl.uniformMatrix4fv(uni.viewProj, false, camOf(id).state.viewProj);   // a moved layer's camera
          const lsec = layerSecOf(ls, sec);
          gl.uniform4f(uni.secPlane, lsec ? lsec.n[0] : 0, lsec ? lsec.n[1] : 0, lsec ? lsec.n[2] : 1, lsec ? lsec.d : 0);
          gl.uniform2f(uni.secCfg, lsec ? 1 : 0, lsec ? lsec.half : 0);
          gl.uniform1i(uni.colorMode, o.colorMode);
          gl.uniform2f(uni.zRange, zr[0], zr[1]);
          gl.uniform1f(uni.intensityScale, 65535 / (ls.intensityMax || 1));
          gl.uniform1f(uni.paletteN, ls.paletteTex ? ls.paletteW : (ls.catN || 32));
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, ls.paletteTex || (ls.catN && catPalette ? catPalette : palette));
          gl.uniform1i(uni.palette, 1);
          gl.uniform1f(uni.filterOn, ls.maskTex ? 1 : 0);
          gl.uniform1f(uni.isolate, ls.isolate ? 1 : 0);
          gl.uniform1f(uni.ghost, 0);
          if (ls.maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ls.maskTex); gl.uniform1i(uni.mask, 4); }
          gl.uniform1f(uni.catVisOn, ls.catVisTex ? 1 : 0);
          if (ls.catVisTex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, ls.catVisTex); gl.uniform1i(uni.catVis, 5); }
          gl.uniform1f(uni.selOn, ls.selTex ? 1 : 0);
          if (ls.selTex) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, ls.selTex); gl.uniform1i(uni.sel, 6); }
          gl.uniform1f(uni.ruleOn, ls.ruleOn && ls.ruleTex ? 1 : 0);
          if (ls.ruleOn && ls.ruleTex) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, ls.ruleTex); gl.uniform1i(uni.rule, 7); }
          gl.uniform1f(uni.chanTexOn, ls.chanTex ? 1 : 0);
          if (ls.chanTex) {
            gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, ls.chanTex); gl.uniform1i(uni.chanTex, 8);
            const cd = chanDocOf(ls, o); gl.uniform2f(uni.chanDoc, cd[0], cd[1]);
          }
          gl.uniform1f(uni.noDataOn, ls.noData ? 1 : 0);
          if (ls.noData) gl.uniform4f(uni.noData, ls.noData[0], ls.noData[1], ls.noData[2], ls.noData[3]);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ls.rampTex || ramp); gl.uniform1i(uni.ramp, 0);
      };
      if (pts.length) {
        const ptsGroups = byLayer(pts);
        ptsFrame(ptsNormal);
        for (const [id, group] of ptsGroups) {
          setupPtsLayer(id);
          for (const c of group) {
            const [first, k] = allot(c);
            if (k > 0) {
              gl.uniform3f(uni.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
              gl.uniform3f(uni.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
              gl.bindVertexArray(c.vao);
              gl.drawArrays(gl.POINTS, first, k);
              drawn += k; c.cursor = first + k;
              if (ghostSlices && ghostIds.has(id)) ghostSlices.push([c, first, k]);
            }
            if (c.cursor < c.count) converged = false;
          }
        }
        if (rp) {
          gl.depthFunc(gl.LEQUAL);
          gl.uniform2ui(uni.repaint, rp[0], rp[1]);
          for (const [id, group] of ptsGroups) {
            setupPtsLayer(id);
            for (const c of group) {
              gl.uniform3f(uni.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
              gl.uniform3f(uni.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
              gl.bindVertexArray(c.vao);
              gl.drawArrays(gl.POINTS, 0, c.count);
            }
          }
          gl.uniform2ui(uni.repaint, 0xFFFFFFFF, 0xFFFFFFFF);
          gl.depthFunc(gl.LESS);
        }
      }

      const perspScale = (canvas.height / 2) / Math.tan(cam.state.fovY / 2);
      const cheapOf = (c) => {
        // the whole chunk below the demotion threshold → the cheap program
        // (no gl_FragDepth → early-z stays on): the far-field perf lever
        const b = c.bboxLocal;
        const bboxR = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
        // sub-blocked: fine grid.size is the fine step — use the chunk's largest box radius
        const s = c.grid.size, q = c.sub ? c.dimQMax : null;
        const rBlock = q
          ? Math.hypot(q[0] * s[0], q[1] * s[1], q[2] * s[2]) / 2
          : Math.hypot(s[0], s[1], s[2]) / 2;
        const distNear = Math.max(cam.state.near, c._dist - bboxR);
        return blocksAsPoints || rBlock * perspScale / distNear < 2.0;
      };
      const beginLayer = (id, projection = false, mipCodes = false, ghost = false) => {
        const ls = layerOf(id), o = lopt(id);
        blocksPipe.begin(camOf(id), {
          pointPx, colorMode: o.colorMode, zRange: zRangeOf(o),
          chanDoc: chanDocOf(ls, o),
          ramp: ls.rampTex || ramp, palette: ls.paletteTex || catPalette || palette, viewportH: canvas.height,
          maskTex: ls.maskTex, isolate: ls.isolate, pointsView: blocksAsPoints, picked: pickedRec, pickedLayer, layer: id,
          section: layerSecOf(ls, sec),
          catVisTex: ls.catVisTex, selTex: ls.selTex, ruleTex: ls.ruleOn ? ls.ruleTex : null,
          chanTex: ls.chanTex, noData: ls.noData,
          opacity: ghost ? 1 : ls.opacity, edges: ls.edges != null ? ls.edges : blockEdges,   // per-layer override, else the View toggle
          projection, mipCodes, ghost,
        });
      };
      const blks = visible.filter((c) => c.kind === 'blocks' && !isMip(c));
      if (blks.length) {
        const blkGroups = byLayer(blks);
        for (const [id, group] of blkGroups) {
          beginLayer(id);
          for (const c of group) {
            const [first, k] = allot(c);
            if (k > 0) {
              blocksPipe.drawSlice(c, first, k, cheapOf(c));
              drawn += k; c.cursor = first + k;
              if (ghostSlices && ghostIds.has(id)) ghostSlices.push([c, first, k]);
            }
            if (c.cursor < c.count) converged = false;
          }
        }
        if (rp) {
          gl.depthFunc(gl.LEQUAL);
          for (const [id, group] of blkGroups) {
            beginLayer(id);                                // begin resets uRepaint — set it after, per layer
            blocksPipe.setRepaint(rp[0], rp[1]);
            for (const c of group) blocksPipe.drawSlice(c, 0, c.count, cheapOf(c));
          }
          blocksPipe.setRepaint(0xFFFFFFFF, 0xFFFFFFFF);
          gl.depthFunc(gl.LESS);
        }
      }
      const stks = visible.filter((c) => c.kind === 'sticks');
      if (stks.length) {
        const stkGroups = byLayer(stks);
        const perspScale2 = cam.state.ortho ? (canvas.height / 2) / cam.state.halfH : (canvas.height / 2) / Math.tan(cam.state.fovY / 2);
        const cheapOf2 = (c) => {
          // whole chunk under the demotion threshold → the no-fragdepth program
          const ls = layerOf(c._layer);
          const b = c.bboxLocal;
          const bboxR = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
          const distNear = Math.max(cam.state.near, c._dist - bboxR);
          // a generous per-chunk proxy: the layer radius at the chunk's nearest point
          return blocksAsPoints || (ls.stickRadius * 4) * perspScale2 / (cam.state.ortho ? 1 : distNear) < 2.0;
        };
        const beginStkLayer = (id) => {
          const ls = layerOf(id), o = lopt(id);
          sticksPipe.begin(camOf(id), {
            pointPx, colorMode: o.colorMode, zRange: zRangeOf(o),
            chanDoc: chanDocOf(ls, o),
            ramp: ls.rampTex || ramp, palette: ls.paletteTex || catPalette || palette, viewportH: canvas.height,
            maskTex: ls.maskTex, isolate: ls.isolate, pointsView: blocksAsPoints, picked: pickedRec, pickedLayer, layer: id,
            section: layerSecOf(ls, sec),
            radius: ls.stickRadius, catVisTex: ls.catVisTex, selTex: ls.selTex, ruleTex: ls.ruleOn ? ls.ruleTex : null,
            chanTex: ls.chanTex, noData: ls.noData,
            opacity: ls.opacity,
          });
        };
        const logSlices = logsPipe ? new Map() : null;      // the slices each logged layer's sticks drew: its tracks draw them too
        for (const [id, group] of stkGroups) {
          beginStkLayer(id);
          const sl = logSlices && logsPipe.has(id) ? [] : null;
          if (sl) logSlices.set(id, sl);
          for (const c of group) {
            const [first, k] = allot(c);
            if (k > 0) {
              sticksPipe.drawSlice(c, first, k, cheapOf2(c));
              drawn += k; c.cursor = first + k;
              if (sl) sl.push([c, first, k]);
            }
            if (c.cursor < c.count) converged = false;
          }
        }
        if (logSlices) for (const [id, sl] of logSlices) {
          const ls = layerOf(id);
          logsPipe.draw(id, sl, camOf(id).state, { maskTex: ls.maskTex, isolate: ls.isolate, section: layerSecOf(ls, sec) });
        }
        if (rp) {
          gl.depthFunc(gl.LEQUAL);
          for (const [id, group] of stkGroups) {
            beginStkLayer(id);
            sticksPipe.setRepaint(rp[0], rp[1]);
            for (const c of group) sticksPipe.drawSlice(c, 0, c.count, cheapOf2(c));
          }
          sticksPipe.setRepaint(0xFFFFFFFF, 0xFFFFFFFF);
          gl.depthFunc(gl.LESS);
        }
      }
      if (rp) repaintSet.clear();

      // ── GHOST (gl-ghost.js): each ghost layer's filtered-OUT records, the slices the raster
      // just drew of it, into the layer's own depth target (accumulating as the raster does);
      // then one pass per layer draws the ghost over the frame — not over a kept element (the
      // stencil), only in front of what is there. An outline waits for the whole layer. ──
      if (ghostIds.size) {
        gl.disable(gl.STENCIL_TEST);
        if (!ghostPipe) ghostPipe = createGhostPipeline(gl);
        const target = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        for (const id of ghostIds) {
          ghostPipe.begin(id, canvas.width, canvas.height, moving);
          const sl = ghostSlices.filter((x) => x[0]._layer === id);
          if (!sl.length) continue;
          if (kindBy.get(id) === 'blocks') {
            beginLayer(id, false, false, true);
            for (const [c, first, k] of sl) blocksPipe.drawSlice(c, first, k, cheapOf(c));
          } else {
            ptsFrame(ptsNormal);
            setupPtsLayer(id);
            gl.uniform1f(uni.isolate, 0); gl.uniform1f(uni.ghost, 1);
            for (const [c, first, k] of sl) {
              gl.uniform3f(uni.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
              gl.uniform3f(uni.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
              gl.bindVertexArray(c.vao);
              gl.drawArrays(gl.POINTS, first, k);
            }
            gl.uniform1f(uni.ghost, 0);
          }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.viewport(0, 0, canvas.width, canvas.height);
        // the default colour: a faint ink of the background's opposite (an outline: a firmer one)
        const lum = 0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2], ink = lum < 0.5 ? 1 : 0;
        const mixBg = (a) => [0, 1, 2].map((i) => background[i] + (ink - background[i]) * a);
        for (const id of ghostIds) {
          const ls = layerOf(id), style = ls.ghost === 'outline' && !lightweight ? 'outline' : 'tint';
          if (style === 'outline' && visible.some((c) => c._layer === id && c.cursor < c.count)) continue;   // not the envelope yet
          ghostPipe.composite(id, { style, color: ls.ghostColor || mixBg(style === 'outline' ? 0.6 : 0.2), width: Math.max(1, Math.round(backingRatio(canvas))) });
        }
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      }

      // ── PROJECTION (gl-mip.js): each projected layer's next slices blend into its
      // own target (the same allotment as the raster, so they converge together),
      // then one fullscreen pass per layer maps the target through its ramp over
      // the frame. Composited LAST, every frame: whatever the raster drew this
      // frame under a projected pixel is painted over again. ──
      let mipInfo = null;
      if (mipIds.size) {
        const target = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        let n = 0, m = 0;
        for (const id of mipIds) {
          const group = visible.filter((c) => c._layer === id);
          mipPipe.begin(id, mipMode, canvas.width, canvas.height, moving);
          const codes = projOf(id) === 'codes';
          if (kindBy.get(id) === 'blocks') {
            beginLayer(id, true, codes);
            for (const c of group) {
              const [first, k] = allot(c);
              if (k > 0) { blocksPipe.drawSlice(c, first, k, cheapOf(c)); drawn += k; c.cursor = first + k; }
            }
          } else {
            if (!ptsMip) ptsMip = ptsProgram('#define MIP 1');
            ptsFrame(ptsMip);
            setupPtsLayer(id);
            gl.uniform1f(uni.mipCodes, codes ? 1 : 0);
            for (const c of group) {
              const [first, k] = allot(c);
              if (k > 0) {
                gl.uniform3f(uni.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
                gl.uniform3f(uni.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
                gl.bindVertexArray(c.vao);
                gl.drawArrays(gl.POINTS, first, k);
                drawn += k; c.cursor = first + k;
              }
            }
            uni = ptsNormal.uni;
          }
          for (const c of group) { n += c.cursor; m += c.count; if (c.cursor < c.count) converged = false; }
        }
        mipPipe.end();
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.viewport(0, 0, canvas.width, canvas.height);
        for (const id of mipIds) {
          const ls = layerOf(id);                          // a code layer composites through its PALETTE (the code is the index)
          if (projOf(id) === 'codes') mipPipe.composite(id, ls.paletteTex || catPalette || palette, { codes: true, width: ls.paletteTex ? ls.paletteW : 256 });
          else mipPipe.composite(id, ls.rampTex || ramp);
        }
        gl.enable(gl.DEPTH_TEST);
        mipInfo = { mode: mipMode, layers: [...mipIds], codes: [...mipIds].filter((id) => projOf(id) === 'codes'), drawn: n, total: m, exact: n === m, w: canvas.width, h: canvas.height };
      }
      lastMip = mipInfo;

      lastConverged = converged;
      gl.bindVertexArray(null);
      return mipInfo ? { drawn, converged, visible: lastVisible, projection: mipInfo } : { drawn, converged, visible: lastVisible };
    },
  };
}

// ── src/core/edl.js ──

// @gcu/condenser — Eye-Dome Lighting post-pass (Boucheny 2009 / Ribes & Boucheny).
// The scene renders into an offscreen framebuffer (color + depth texture); a
// fullscreen pass compares each pixel's log-linear depth against its neighbors
// and darkens where neighbors are closer — unlit points read as a surface.
// Mandatory in M1 (micro-spec §2.2): without it a point cloud reads as noise.
//
// AMBIENT OCCLUSION (opt-in, `ao` > 0): EDL darkens at depth JUMPS — silhouettes, rims. The
// occlusion term darkens where surfaces meet at an angle — inner corners, the foot of a pit
// wall, between stacked benches — from the same depth target, in the same pass: pairs of
// opposite samples on a disc around the pixel; where the pair's mean depth is NEARER than the
// pixel's (a concave crease — a flat face, however tilted, gives none), the pixel darkens in
// proportion, within a world-space radius (occluders far in front don't halo). Off, the pass
// is unchanged (one uniform branch).


const QUAD_VERT$edl = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {                          // fullscreen triangle, no buffers
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const EDL_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uTexel;                   // 1/size
uniform vec2 uNearFar;
uniform float uOrtho;                  // 1 = orthographic (depth is already linear)
uniform float uStrength;               // 0 = off-look, ~1 default
uniform float uRadius;                 // sample radius in pixels
uniform float uAo;                     // ambient occlusion strength (0 = off)
uniform float uAoRadius;               // its disc radius in pixels
uniform vec2 uPxWorld;                 // world size of a pixel: x · (perspective: linear depth) + y
out vec4 outColor;

float linDepth(float d) {              // depth buffer -> linear eye-space z
  float n = uNearFar.x, f = uNearFar.y;
  if (uOrtho > 0.5) return n + d * (f - n);
  return (2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
}
void main() {
  vec4 col = texture(uColor, vUv);
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) { outColor = col; return; }              // background: untouched
  float zc = log2(max(linDepth(d), 1e-6));
  float ob = 0.0;
  const vec2 DIRS[8] = vec2[8](vec2(1.,0.), vec2(-1.,0.), vec2(0.,1.), vec2(0.,-1.),
                               vec2(.7,.7), vec2(-.7,.7), vec2(.7,-.7), vec2(-.7,-.7));
  for (int i = 0; i < 8; i++) {
    float dn = texture(uDepth, vUv + DIRS[i] * uTexel * uRadius).r;
    float zn = dn >= 1.0 ? zc + 4.0 : log2(max(linDepth(dn), 1e-6));   // background neighbor = far
    ob += max(0.0, zc - zn);
  }
  float shade = exp(-uStrength * 60.0 * ob / 8.0);
  if (uAo > 0.0) {
    float zl = linDepth(d);
    float rw = max((uPxWorld.x * zl + uPxWorld.y) * uAoRadius, 1e-6);   // the disc's radius in world units
    float occ = 0.0;
    const int PAIRS = 8;
    for (int i = 0; i < PAIRS; i++) {
      float a = float(i) * 2.39996323 + 0.7;             // golden-angle directions
      float r = uAoRadius * (0.35 + 0.65 * fract(float(i) * 0.618034));
      vec2 o = vec2(cos(a), sin(a)) * r * uTexel;
      float d1 = texture(uDepth, vUv + o).r, d2 = texture(uDepth, vUv - o).r;
      if (d1 >= 1.0 || d2 >= 1.0) continue;               // the background is no occluder
      float dz = zl - 0.5 * (linDepth(d1) + linDepth(d2));   // > 0: the pair's mean is nearer — a crease
      float w = 1.0 - smoothstep(rw * 1.5, rw * 3.0, abs(zl - min(linDepth(d1), linDepth(d2))));   // far in front: another object
      occ += clamp((dz - 0.04 * rw) / rw, 0.0, 1.0) * w;    // a hair of bias: a curved or splatted surface's noise isn't a crease
    }
    shade *= 1.0 - min(0.85, uAo * 1.6 * occ / float(PAIRS));
  }
  outColor = vec4(col.rgb * shade, col.a);
}`;

function createEdl(gl) {
  const prog = makeProgram(gl, QUAD_VERT$edl, EDL_FRAG);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uni = { color: U('uColor'), depth: U('uDepth'), texel: U('uTexel'), nearFar: U('uNearFar'), ortho: U('uOrtho'), strength: U('uStrength'), radius: U('uRadius'),
    ao: U('uAo'), aoRadius: U('uAoRadius'), pxWorld: U('uPxWorld') };
  let fbo = null, colorTex = null, depthTex = null, w = 0, h = 0;

  function ensure(width, height) {
    if (width === w && height === h && fbo) return;
    w = width; h = height;
    if (fbo) { gl.deleteFramebuffer(fbo); gl.deleteTexture(colorTex); gl.deleteTexture(depthTex); }
    const tex = (ifmt, fmt, type) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    colorTex = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    // depth + STENCIL: the ghost filter display (gl-ghost.js) marks kept elements in the stencil;
    // the depth half reads exactly as a DEPTH_COMPONENT24 texture did
    depthTex = tex(gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL, gl.UNSIGNED_INT_24_8);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  return {
    // Render `sceneDraw()` through the EDL pipeline onto the default framebuffer.
    // ALWAYS goes via the FBO — progressive accumulation (§2.2) needs a persistent
    // depth buffer, which the default framebuffer doesn't guarantee; EDL-disabled
    // is strength 0 (exp(0) ≡ passthrough), so there's exactly one path.
    // ao: ambient occlusion strength (0 = off, ~1 a clear crease shade), aoRadius its disc in px
    render(width, height, cam, sceneDraw, { enabled = true, strength = 1.0, radius = 1.4, ao = 0, aoRadius = 10 } = {}) {
      ensure(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, w, h);
      const result = sceneDraw();                          // the splat pass, into the FBO (may draw 0 when converged)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, colorTex); gl.uniform1i(uni.color, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, depthTex); gl.uniform1i(uni.depth, 3);
      gl.uniform2f(uni.texel, 1 / w, 1 / h);
      gl.uniform2f(uni.nearFar, cam.state.near, cam.state.far);
      gl.uniform1f(uni.ortho, cam.state.ortho ? 1 : 0);
      gl.uniform1f(uni.strength, enabled ? strength : 0);
      gl.uniform1f(uni.radius, radius);
      gl.uniform1f(uni.ao, ao > 0 ? ao : 0);
      if (ao > 0) {
        const st = cam.state;
        gl.uniform1f(uni.aoRadius, aoRadius);
        // a pixel's world size: ortho — the view height over the pixels; perspective — ∝ the depth
        if (st.ortho) gl.uniform2f(uni.pxWorld, 0, (2 * st.halfH) / h);
        else gl.uniform2f(uni.pxWorld, (2 * Math.tan(st.fovY / 2)) / h, 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      return result;
    },
  };
}

// ── src/grid/support.js ──

// @gcu/condenser — the BLOCK-SUPPORT contract (micro-block-support spec §2).
//
// One description of a block model's support, filled by the readers and read by
// every consumer, so a new kind of model is a new reader rather than a dozen edits:
//
//   frame    { anchor (world, f64), R (3×3 column-major, world ← lattice) }
//            R = identity and anchor = 0 for an axis-aligned model.
//   lattice  { pitch [3] — the FINE step per axis, lattice frame,
//              originQ [3] — the centroid of fine cell (0,0,0), lattice coords,
//              count [3] }
//            regular model: pitch = the block size; sub-blocked: pitch = half the
//            finest size step per axis, so odd sizes still centre on-lattice.
//   extent   per-block size in FINE STEPS per axis:
//            regular     → the constant sizeQ (1,1,1) — 0 bytes per block;
//            sub-blocked → `dimQ`, u8 × 3 per block (any integer shape ≤ 255 steps).
//
// Derived, never stored: centre = anchor + R·(originQ + ijk·pitch); half = sizeQ·pitch/2
// (lattice frame); volume = Π sizeQ·pitch; world AABB half = |R|·half.
//
// COLUMNAR, not per-record: the contract is data (constants + typed arrays) plus a
// few pure helpers small enough to inline. No boxOf(record) returning an object —
// hot loops read the support once and do the arithmetic themselves.

const SIZEQ_MAX = 255;                              // dimQ is u8 per axis
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * The support of a header's grid. `grid` = { x, y, z: { origin, pitch, count },
 * rot?, anchor? } (grid/basis.js form); subBlocked = the model carries per-block
 * dimQ. → { frame, lattice, sub, sizeQ, sizeQMax } or null without a grid.
 */
function supportOf(grid, { subBlocked = false, sizeQMax = null } = {}) {
  if (!grid || !grid.x) return null;
  const rotated = !!grid.rot;
  return {
    frame: { anchor: rotated ? [...(grid.anchor || [0, 0, 0])] : [0, 0, 0], R: rotated ? Array.from(grid.rot) : I3.slice(), rotated },
    lattice: {
      pitch: [grid.x.pitch, grid.y.pitch, grid.z.pitch],
      originQ: [grid.x.origin, grid.y.origin, grid.z.origin],
      count: [grid.x.count, grid.y.count, grid.z.count],
    },
    sub: !!subBlocked,
    sizeQ: subBlocked ? null : [1, 1, 1],                  // regular: one constant, no array
    sizeQMax: subBlocked ? (sizeQMax ? [...sizeQMax] : null) : [1, 1, 1],
  };
}
/** A header's support (grid + the sub-block facts it carries). */
const supportOfHeader = (h) => (h ? supportOf(h.grid, { subBlocked: !!h.subBlocked, sizeQMax: h.sizeQMax || null }) : null);

/** Volume of a block of sizeQ (sx, sy, sz) fine steps. */
const volumeOf = (sx, sy, sz, pitch) => sx * pitch[0] * sy * pitch[1] * sz * pitch[2];
/**
 * Volume of a block from its stated sizes (a record's XINC/YINC/ZINC, DX/DY/DZ),
 * through the contract: each size snapped to whole fine steps, × the pitch — the
 * same box the renderer draws (dimQ). null when a size is missing / not positive
 * (the caller decides what that block weighs).
 */
function volumeOfSizes(dx, dy, dz, pitch) {
  if (!(dx > 0 && dy > 0 && dz > 0)) return null;
  return volumeOf(sizeQ(dx, pitch[0]), sizeQ(dy, pitch[1]), sizeQ(dz, pitch[2]), pitch);
}

/** world → lattice: q = Rᵀ·(p − anchor). out is written and returned. */
function toLattice(frame, x, y, z, out = [0, 0, 0]) {
  const R = frame.R, A = frame.anchor;
  const dx = x - A[0], dy = y - A[1], dz = z - A[2];
  out[0] = R[0] * dx + R[1] * dy + R[2] * dz;
  out[1] = R[3] * dx + R[4] * dy + R[5] * dz;
  out[2] = R[6] * dx + R[7] * dy + R[8] * dz;
  return out;
}
/** lattice → world: p = anchor + R·q. */
function toWorld$support(frame, u, v, w, out = [0, 0, 0]) {
  const R = frame.R, A = frame.anchor;
  out[0] = A[0] + R[0] * u + R[3] * v + R[6] * w;
  out[1] = A[1] + R[1] * u + R[4] * v + R[7] * w;
  out[2] = A[2] + R[2] * u + R[5] * v + R[8] * w;
  return out;
}
/** The world-axis half extent of a lattice-frame half box: |R|·h. */
function worldHalfExtent(R, hx, hy, hz, out = [0, 0, 0]) {
  out[0] = Math.abs(R[0]) * hx + Math.abs(R[3]) * hy + Math.abs(R[6]) * hz;
  out[1] = Math.abs(R[1]) * hx + Math.abs(R[4]) * hy + Math.abs(R[7]) * hz;
  out[2] = Math.abs(R[2]) * hx + Math.abs(R[5]) * hy + Math.abs(R[8]) * hz;
  return out;
}
/** World centroid of fine cell (i, j, k). */
function centreOf(sup, i, j, k, out = [0, 0, 0]) {
  const L = sup.lattice;
  return toWorld$support(sup.frame, L.originQ[0] + i * L.pitch[0], L.originQ[1] + j * L.pitch[1], L.originQ[2] + k * L.pitch[2], out);
}

/**
 * Do two supports share a lattice — the same orientation and pitch, and nodes that
 * coincide (their origins differ by whole fine steps once expressed about one anchor)?
 */
function sameLattice(a, b, tol = 1e-6) {
  if (!a || !b) return false;
  for (let i = 0; i < 9; i++) if (Math.abs(a.frame.R[i] - b.frame.R[i]) > 1e-4) return false;
  const pa = a.lattice.pitch, pb = b.lattice.pitch;
  for (let i = 0; i < 3; i++) if (Math.abs(pa[i] - pb[i]) > tol * Math.max(1, Math.abs(pa[i]))) return false;
  // b's node 0 in a's lattice coordinates
  const w = toWorld$support(b.frame, b.lattice.originQ[0], b.lattice.originQ[1], b.lattice.originQ[2]);
  const q = toLattice(a.frame, w[0], w[1], w[2]);
  for (let i = 0; i < 3; i++) {
    const s = (q[i] - a.lattice.originQ[i]) / pa[i];
    if (Math.abs(s - Math.round(s)) > 1e-3) return false;
  }
  return true;
}

// ── sub-block sizes ───────────────────────────────────────────────────────────
// Discovery collects per-axis DISTINCT sizes (a few dozen on any real model, however
// many shapes they combine into — the Isatis file has 3,288 shapes from ~20 sizes
// per axis), the per-axis min/max, and a capped count of distinct shapes for the
// description. Mergeable, so a parallel discovery (row groups on workers) merges.

const r10 = (v) => Number(v.toPrecision(10));
const r7 = (v) => Number(v.toPrecision(7));
const SIZES_CAP = 4096, SHAPES_CAP = 1 << 16;
function sizeCollector() {
  const axes = [new Set(), new Set(), new Set()];          // distinct sizes per axis (10 significant digits)
  // a size's index = its 7-digit value's (so float noise in a file's sizes — 0.9999999963 vs
  // 0.9999999935, f32 round trips — is one size, one shape); raw → index is memoized, the memo bounded apart from the cap
  const idx = [new Map(), new Map(), new Map()], memo = [new Map(), new Map(), new Map()], raw = [[], [], []];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const shapes = new Set();                                // i·2²⁴ + j·2¹² + k over the size indices — no string per block
  let overflow = false, any = 0;
  const ixOf = (a, v) => {
    let i = memo[a].get(v);
    if (i !== undefined) return i;
    if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v;
    const k = r7(v);
    i = idx[a].get(k);
    if (i === undefined) {
      if (raw[a].length >= SIZES_CAP) { overflow = true; return 0; }
      i = raw[a].length; raw[a].push(v); idx[a].set(k, i); axes[a].add(r10(v));
    }
    if (memo[a].size < 65536) memo[a].set(v, i);
    return i;
  };
  return {
    axes, min, max,
    get overflow() { return overflow; },
    get count() { return any; },
    get shapes() { return shapes.size; },
    /** one block's (dx, dy, dz) — non-positive sizes are ignored */
    add(dx, dy, dz) {
      if (!(dx > 0 && dy > 0 && dz > 0)) return;
      any++;
      const key = ixOf(0, dx) * 16777216 + ixOf(1, dy) * 4096 + ixOf(2, dz);
      if (shapes.size < SHAPES_CAP) shapes.add(key);
    },
    /** a partial collector's snapshot (toJSON form) merged in */
    // Merged IN ORDER (partials of consecutive record ranges, first to last), the
    // result is the sequential sweep's: each axis's sizes go in first, in their
    // first-appearance order (so a size's index and its representative value — the
    // first raw value of its 7-digit class — are the sweep's), then the shapes, and
    // the raw min/max (which see every noisy value, not just the representatives).
    merge(s) {
      if (!s) return;
      for (let a = 0; a < 3; a++) for (const v of s.raw[a]) ixOf(a, v);   // sizes past the shape cap still count
      for (const [dx, dy, dz] of s.shapes) this.add(dx, dy, dz);
      any += (s.count || 0) - s.shapes.length;
      if (s.min) for (let a = 0; a < 3; a++) { if (s.min[a] < min[a]) min[a] = s.min[a]; if (s.max[a] > max[a]) max[a] = s.max[a]; }
      if (s.overflow) overflow = true;
    },
    /** a structured-cloneable snapshot (a worker's partial) */
    toJSON() {
      const sh = [];
      for (const key of shapes) sh.push([raw[0][Math.floor(key / 16777216)], raw[1][Math.floor(key / 4096) % 4096], raw[2][key % 4096]]);
      return { raw: raw.map((r) => [...r]), shapes: sh, overflow, count: any, min: [...min], max: [...max] };
    },
    /** do sizes vary at all? (one shape = a regular model in disguise) */
    get varies() { return axes.some((x) => x.size > 1); },
  };
}

// the GCD of positive reals, tolerant of float noise; NaN when there's none
function realGcd(vals) {
  const big = Math.max(...vals), tol = big * 1e-7;
  let g = vals[0];
  for (let k = 1; k < vals.length; k++) {
    let a = Math.max(g, vals[k]), b = Math.min(g, vals[k]), it = 0;
    while (b > tol && it++ < 200) { let r = a % b; if (b - r < tol) r = 0; a = b; b = r; }
    g = a;
  }
  for (const v of vals) { const s = v / g; if (Math.abs(s - Math.round(s)) > 1e-4) return NaN; }
  return g;
}
/**
 * The fine pitch per axis for a collector's sizes: half the GCD of the distinct
 * sizes, so every integer combination of them centres on-lattice (when the smallest
 * divides the rest — the common case — that is half the smallest, as before).
 * → { pitch: [3], sizeQMax: [3] } | { refused: message } | null (no usable sizes).
 */
function finePitch(sizes) {
  if (!sizes || !sizes.count || sizes.overflow) return null;
  const pitch = [0, 0, 0], sizeQMax = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const vals = [...sizes.axes[a]];
    if (!vals.length) return null;
    const g = realGcd(vals);
    if (!(g > 0)) return null;
    pitch[a] = g / 2;
    sizeQMax[a] = Math.round(sizes.max[a] / pitch[a]);
    if (sizeQMax[a] > SIZEQ_MAX) {
      const ax = 'XYZ'[a];
      return { refused: `sub-block sizes along ${ax} run from ${r10(sizes.min[a])} to ${r10(sizes.max[a])} on a ${r10(g)} step — ${sizeQMax[a]} fine steps, past the ${SIZEQ_MAX} a block can span (largest more than ${Math.floor(SIZEQ_MAX / 2)}× the step). Shown as points.` };
    }
  }
  return { pitch, sizeQMax };
}
/** One block's size in fine steps along an axis (clamped to 1..255). */
const sizeQ = (d, pitch) => { const q = Math.round(d / pitch); return q < 1 ? 1 : q > SIZEQ_MAX ? SIZEQ_MAX : q; };
/** Write one block's dimQ triple at k into a Uint8Array(3n). */
function putDimQ(out, k, dx, dy, dz, pitch) {
  out[k * 3] = sizeQ(dx, pitch[0]); out[k * 3 + 1] = sizeQ(dy, pitch[1]); out[k * 3 + 2] = sizeQ(dz, pitch[2]);
}
/** A header's fine pitch (the grid's per-axis pitch — for a sub-blocked model the fine step). */
const pitchOf = (grid) => [grid.x.pitch, grid.y.pitch, grid.z.pitch];

// ── Datamine rotation ─────────────────────────────────────────────────────────
/**
 * R for a single Datamine rotation about Z (ROTAXIS1 = 3): ANGLE1 turns the model
 * axes CLOCKWISE seen from above, i.e. R rotates by −ANGLE1 in the math (CCW) sense.
 * world = O + R·(XC, YC, ZC). ANGLE1 = −50 → model X at N40°E. Column-major.
 * Verified on a real Isatis.neo export to 1 cm (memory: reference_datamine_rotation).
 */
function datamineRotZ(angle1Deg) {
  const t = (-angle1Deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
/**
 * A rotated .dm's PLACEMENT, as data (structured-cloneable, so a worker reading
 * page runs applies the same one): the coordinate column indices + R + O.
 * world = O + R·(XC, YC, ZC). null for a model that isn't placed.
 */
const dmPlaceOf = (h) => (h && h.dmPlace) || null;
/**
 * Map a decoded column batch's coordinate columns local → world IN PLACE (cols is
 * { [colIdx]: Float64Array }, fresh arrays from a run read). A missing coordinate
 * (NaN) leaves the record's three NaN — there is no world position without all three.
 */
function placeDmColumns(place, cols, count) {
  if (!place) return cols;
  const X = cols[place.x], Y = cols[place.y], Z = cols[place.z];
  if (!X || !Y || !Z) return cols;
  const R = place.R, O = place.O;
  for (let k = 0; k < count; k++) {
    const x = X[k], y = Y[k], z = Z[k];
    X[k] = O[0] + R[0] * x + R[3] * y + R[6] * z;
    Y[k] = O[1] + R[1] * x + R[4] * y + R[7] * z;
    Z[k] = O[2] + R[2] * x + R[5] * y + R[8] * z;
  }
  return cols;
}
/** The same for one decoded record (positional values; null = missing). In place. */
function placeDmRow(place, row) {
  if (!place || !row) return row;
  const x = row[place.x], y = row[place.y], z = row[place.z];
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return row;
  const R = place.R, O = place.O;
  row[place.x] = O[0] + R[0] * x + R[3] * y + R[6] * z;
  row[place.y] = O[1] + R[1] * x + R[4] * y + R[7] * z;
  row[place.z] = O[2] + R[2] * x + R[5] * y + R[8] * z;
  return row;
}
/** world → the model's own (local) frame for a placed .dm: Rᵀ·(p − O)/s² (R = s·rotation; s = 1 for Datamine's own). */
function dmWorldToLocal(place, x, y, z, out = [0, 0, 0]) {
  const R = place.R, O = place.O, dx = x - O[0], dy = y - O[1], dz = z - O[2];
  const k = 1 / (R[0] * R[0] + R[1] * R[1] + R[2] * R[2]);
  out[0] = k * (R[0] * dx + R[1] * dy + R[2] * dz);
  out[1] = k * (R[3] * dx + R[4] * dy + R[5] * dz);
  out[2] = k * (R[6] * dx + R[7] * dy + R[8] * dz);
  return out;
}
/**
 * A rotated .dm placed in world keeps LOCAL XC/YC/ZC in its file; the provider's
 * readers (columnBatches / recordBatches / fetchRecord, and readDmRun with the
 * header's dmPlace) hand them over in WORLD. This maps one point the same way, for a
 * caller holding raw local values. → (x, y, z) → [wx, wy, wz] for such a header, else null.
 */
function dmLocalToWorld(h) {
  if (!h || !h.dmRotationApplied) return null;
  const O = h.dmOrigin || [0, 0, 0], R = h.grid && h.grid.rot ? h.grid.rot : datamineRotZ(h.dmRotation[0].angle);
  return (x, y, z) => [O[0] + R[0] * x + R[3] * y + R[6] * z, O[1] + R[1] * x + R[4] * y + R[7] * z, O[2] + R[2] * x + R[5] * y + R[8] * z];
}

// ── src/core.js ──

// @gcu/condenser/core — the render engine alone: chunk builders + GL pipelines
// + camera + EDL + Morton. Zero I/O, zero providers; @gcu/frame is the one
// inlined leaf (every chunk is frame-relative). The full package (main.js)
// re-exports this same surface plus io/ + grid/.
// the block-support contract (pure data + helpers; grid/support.js) — the engine draws by it

export {
  mulberry32,
  shuffledIndices,
  shuffleInPlace,
  documentFrame,
  buildChunk,
  chunkLocalPosition,
  createChunkBuilder,
  part1by2,
  mortonKey,
  mortonKeys,
  radixSortIndices,
  makeBlockGrid,
  buildBlockChunk,
  blockLocalCenter,
  createBlockChunkBuilder,
  buildBlockBatch,
  batchSeed,
  batchSizeAt,
  dimQFromCodes,
  buildStickChunk,
  stickLocalCenter,
  createStickChunkBuilder,
  buildMeshChunk,
  buildHeightfieldMesh,
  buildSoupChunk,
  soupLocalCentroid,
  createSoupChunkBuilder,
  soupFromMesh,
  createSticksPipeline,
  createMeshPipeline,
  createSoupPipeline,
  categoryPalettePixels,
  createBlocksPipeline,
  createPickPipeline,
  layerOfId,
  faceOfId,
  isMiss,
  NO_FACE,
  FACE_CUT,
  FACE_NORMALS,
  FACE_NAMES,
  layerSection,
  meshSection,
  offsetSection,
  mat4Perspective,
  mat4Ortho,
  mat4LookAt,
  mat4Multiply,
  mat4Inverse,
  transformPoint,
  frustumPlanes,
  aabbInFrustum,
  translateState,
  createOrbitCamera,
  attachOrbitInput,
  makeProgram,
  rampPixels,
  palettePixels,
  uploadChunk,
  createRenderer,
  createEdl,
  createMipPipeline,
  decodeProjection,
  PROJECTION_MODES,
  createGhostPipeline,
  GHOST_STYLES,
  createLogsPipeline,
  LOG_KINDS,
  SIZEQ_MAX,
  supportOf,
  supportOfHeader,
  volumeOf,
  toLattice as supportToLattice,
  toWorld$support as supportToWorld,
  worldHalfExtent,
  centreOf,
  sameLattice,
  sizeCollector,
  finePitch,
  sizeQ,
  putDimQ,
  pitchOf,
  datamineRotZ,
  dmLocalToWorld,
  dmPlaceOf,
  placeDmColumns,
  placeDmRow,
  dmWorldToLocal,
  volumeOfSizes,
};
