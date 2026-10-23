// DXF, STREAMED — for a file too big to read whole. openDxf (dxf-provider.js) parses
// resident, which caps a DXF at what one JS string holds (~512 M characters; past
// that the browser's read fails, Chrome calling it a "permission problem"). A
// triangulated topography exported as 3DFACEs reaches gigabytes, so this provider
// walks the Blob in slices through @gcu/dxf's push-parser and hands the geometry
// out as BATCHES for the streaming builders, holding nothing but the batch in
// flight plus each kind's small per-record table:
//
//   openDxfStream(blob, { as }) → { header, batches(opts), summary }
//     header  — kind:'dxf-stream', bbox (SAMPLED: head + windows across the file —
//               it plants the frame and the first camera, nothing quantizes on it),
//               headerVars, size
//     batches — async generator of { kind:'mesh', raw } (soup RawChunks — the
//               createSoupChunkBuilder contract), { kind:'strings', raw } (stick
//               RawChunks, category = DXF layer), { kind:'points', raw }
//     summary — filled as the stream runs, final when it ends: counts, per-kind
//               categories + authored colours, the uniform mesh colour, warnings,
//               and each kind's record accessors (fetchRecord / recordPosition)
//
// One pass yields every kind the file holds; `as` keeps only one (a reinterpret or
// a project reload asks for exactly the layer it is restoring).
import { createSceneStream, peekDxf } from '../../../dxf/src/stream.js';

// above this a consumer should stream (below it the resident reader is exact and
// keeps the full mesh tier: solid queries, mesh export, welded surfaces)
export const DXF_STREAM_BYTES = 256 * 1024 * 1024;
const SLAB = 8 << 20;                                       // 8 MB reads
const HEAD = 16 << 20;                                      // the head peek / first bbox sample
const WINDOW = 256 << 10, WINDOWS = 24;                     // bbox sampling across the file

// growable typed column (records the strings / points tables keep)
function column(Type, init = 1 << 16) {
  let a = new Type(init), n = 0;
  return {
    push(v) { if (n === a.length) { const b = new Type(a.length * 2); b.set(a); a = b; } a[n++] = v; },
    get length() { return n; },
    at(i) { return a[i]; },
  };
}

// the plausible-coordinate guard (the 1e20 "unset" extents some exporters write)
const plausible = (v) => Number.isFinite(v) && Math.abs(v) < 1e12;

/**
 * Sampled bounds: the head, then WINDOWS evenly spaced slices, each resynced to an
 * entity boundary (a "0" code line followed by an entity name) and cut at the last
 * one (so no number is read truncated). Approximate by design — enough to plant a
 * frame origin near the data and aim the first camera; the layers' true bboxes come
 * from the builders as the geometry arrives.
 */
async function sampleBounds(blob) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const grow = (x, y, z) => {
    if (!plausible(x) || !plausible(y) || !plausible(z)) return;
    if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
  };
  const sink = {
    tri(l, c, ax, ay, az, bx, by, bz, cx, cy, cz) { grow(ax, ay, az); grow(bx, by, bz); grow(cx, cy, cz); },
    string(l, c, p) { for (let i = 0; i + 2 < p.length; i += 3) grow(p[i], p[i + 1], p[i + 2]); },
    point(l, c, x, y, z) { grow(x, y, z); },
    vertex(x, y, z) { grow(x, y, z); },                     // a window inside one giant polyface still counts
  };
  const POLYFACE_HEAD = new TextEncoder().encode('0\nPOLYLINE\n70\n64\n');
  const ENTITY_START = /\n[ \t]*0\r?\n(?=[A-Z3])/g;
  const sampleAt = async (off, len, inEntities) => {
    const bytes = new Uint8Array(await blob.slice(off, Math.min(blob.size, off + len)).arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    const starts = [...text.matchAll(ENTITY_START)].map((m) => m.index + 1);
    if (starts.length < 2) return;
    const from = inEntities ? starts[0] : 0, to = starts[starts.length - 1];
    const st = createSceneStream(sink, inEntities ? { section: 'ENTITIES' } : {});
    // a window that opens mid-POLYLINE: give its VERTEX run a header to belong to
    if (inEntities && text.startsWith('VERTEX', from + text.slice(from).indexOf('\n') + 1)) st.push(POLYFACE_HEAD);
    st.push(bytes.subarray(from, to));
    st.end();
  };
  await sampleAt(0, HEAD, false);                           // the head: real section structure
  if (blob.size > HEAD) {
    for (let k = 1; k <= WINDOWS; k++) {
      const off = Math.floor(((blob.size - WINDOW) * k) / WINDOWS);
      if (off > HEAD) await sampleAt(off, WINDOW, true);
    }
  }
  return min[0] === Infinity ? null : { min, max };
}

/** peekDxfHead(blob) — the dialog's description of a file too big to preview whole. */
export async function peekDxfHead(blob, bytes = 8 << 20) {
  const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, bytes)).arrayBuffer());
  const p = peekDxf(head);
  return { ...p, partial: head.length < blob.size, fraction: head.length / (blob.size || 1) };
}

export async function openDxfStream(blob, { as = null } = {}) {
  let bbox = await sampleBounds(blob);
  let headerVars = null;
  {
    const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 1 << 20)).arrayBuffer());
    headerVars = peekDxf(head).header;
    if (!bbox && headerVars.extmin && headerVars.extmax && [...headerVars.extmin, ...headerVars.extmax].every(plausible)) {
      bbox = { min: headerVars.extmin.slice(), max: headerVars.extmax.slice() };
    }
  }
  if (!bbox) bbox = { min: [0, 0, 0], max: [1, 1, 1] };
  const header = { kind: 'dxf-stream', format: 'dxf', bbox, size: blob.size, headerVars, sampledBbox: true };

  const want = (k) => !as || as === k;
  // per-kind category tables (≤ 255 layers fit the category byte; past that a kind
  // keeps its geometry and drops its classes, like the resident reader)
  const catTable = () => ({ names: [], colors: [], index: new Map(), overflow: false });
  const cats = { strings: catTable(), points: catTable() };
  const catOf = (t, layer, rgb) => {
    let i = t.index.get(layer);
    if (i === undefined) {
      if (t.names.length >= 255) { t.overflow = true; return 0; }
      i = t.names.length; t.index.set(layer, i); t.names.push(layer); t.colors.push(rgb || null);
    } else if (!t.colors[i] && rgb) t.colors[i] = rgb;
    return i;
  };
  // records: strings keep (layer, string id) + a midpoint per segment; points keep xyz + layer
  const o = bbox.min;                                       // midpoints stored f32 local to here (mm at km extents)
  const seg = { cat: column(Uint8Array), str: column(Uint32Array), mx: column(Float32Array), my: column(Float32Array), mz: column(Float32Array) };
  const pt = { x: column(Float64Array), y: column(Float64Array), z: column(Float64Array), cat: column(Uint8Array) };
  let meshColor;                                            // uniform → the tint; mixed → null

  const summary = {
    done: false, counts: { triangles: 0, strings: 0, segments: 0, points: 0 }, warnings: [], warningsSuppressed: 0,
    meshColor: null, kinds: [],
    strings: { categories: null, catColors: null, fetchRecord: (rec) => [cats.strings.names[seg.cat.at(rec)], seg.str.at(rec)], recordPosition: (rec) => [o[0] + seg.mx.at(rec), o[1] + seg.my.at(rec), o[2] + seg.mz.at(rec)] },
    points: { categories: null, catColors: null, fetchRecord: (rec) => [pt.x.at(rec), pt.y.at(rec), pt.z.at(rec), cats.points.names[pt.cat.at(rec)]] },
  };

  async function* batches({ batchTris = 1 << 16, batchSegs = 1 << 16, batchPoints = 1 << 16, onProgress, signal } = {}) {
    const queue = [];
    const MESH = ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'cx', 'cy', 'cz', 'x', 'y', 'z'];
    const newMesh = () => { const b = { count: 0 }; for (const c of MESH) b[c] = new Float64Array(batchTris); return b; };
    const STICK = ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'x', 'y', 'z'];
    const newStick = () => { const b = { count: 0, cat: new Uint8Array(batchSegs), recIdx: new Uint32Array(batchSegs), chan: new Float64Array(batchSegs) }; for (const c of STICK) b[c] = new Float64Array(batchSegs); return b; };
    const newPts = () => ({ count: 0, x: new Float64Array(batchPoints), y: new Float64Array(batchPoints), z: new Float64Array(batchPoints), cat: new Uint8Array(batchPoints), recIdx: new Uint32Array(batchPoints), recStart: pt.x.length });
    const trim = (b, cols) => { const n = b.count; for (const c of cols) b[c] = b[c].subarray(0, n); return b; };
    let mb = null, sb = null, pb = null;
    const flushMesh = () => { if (mb && mb.count) queue.push({ kind: 'mesh', raw: trim(mb, MESH) }); mb = null; };
    const flushSticks = () => { if (sb && sb.count) queue.push({ kind: 'strings', raw: trim(sb, [...STICK, 'cat', 'recIdx', 'chan']) }); sb = null; };
    const flushPts = () => { if (pb && pb.count) queue.push({ kind: 'points', raw: trim(pb, ['x', 'y', 'z', 'cat', 'recIdx']) }); pb = null; };

    const sink = {
      tri(layer, rgb, ax, ay, az, bx, by, bz, cx, cy, cz) {
        if (!want('mesh')) return;
        if (meshColor === undefined) meshColor = rgb;
        else if (meshColor && (!rgb || meshColor[0] !== rgb[0] || meshColor[1] !== rgb[1] || meshColor[2] !== rgb[2])) meshColor = null;
        if (!mb) mb = newMesh();
        const i = mb.count++;
        mb.ax[i] = ax; mb.ay[i] = ay; mb.az[i] = az; mb.bx[i] = bx; mb.by[i] = by; mb.bz[i] = bz;
        mb.cx[i] = cx; mb.cy[i] = cy; mb.cz[i] = cz;
        mb.x[i] = (ax + bx + cx) / 3; mb.y[i] = (ay + by + cy) / 3; mb.z[i] = (az + bz + cz) / 3;
        summary.counts.triangles++;
        if (mb.count === batchTris) flushMesh();
      },
      string(layer, rgb, p) {
        if (!want('strings')) return;
        const code = catOf(cats.strings, layer, rgb);
        const sid = summary.counts.strings++;
        for (let k = 0; k + 5 < p.length; k += 3) {
          if (!sb) sb = newStick();
          const i = sb.count++;
          const rec = seg.cat.length;
          sb.ax[i] = p[k]; sb.ay[i] = p[k + 1]; sb.az[i] = p[k + 2];
          sb.bx[i] = p[k + 3]; sb.by[i] = p[k + 4]; sb.bz[i] = p[k + 5];
          const mx = (p[k] + p[k + 3]) / 2, my = (p[k + 1] + p[k + 4]) / 2, mz = (p[k + 2] + p[k + 5]) / 2;
          sb.x[i] = mx; sb.y[i] = my; sb.z[i] = mz;
          sb.cat[i] = code; sb.recIdx[i] = rec;
          seg.cat.push(code); seg.str.push(sid); seg.mx.push(mx - o[0]); seg.my.push(my - o[1]); seg.mz.push(mz - o[2]);
          summary.counts.segments++;
          if (sb.count === batchSegs) flushSticks();
        }
      },
      point(layer, rgb, x, y, z) {
        if (!want('points')) return;
        const code = catOf(cats.points, layer, rgb);
        if (!pb) pb = newPts();
        const i = pb.count++;
        pb.x[i] = x; pb.y[i] = y; pb.z[i] = z; pb.cat[i] = code; pb.recIdx[i] = pt.x.length;
        pt.x.push(x); pt.y.push(y); pt.z.push(z); pt.cat.push(code);
        summary.counts.points++;
        if (pb.count === batchPoints) flushPts();
      },
    };

    const st = createSceneStream(sink);
    let at = 0;
    while (at < blob.size) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const end = Math.min(blob.size, at + SLAB);
      st.push(new Uint8Array(await blob.slice(at, end).arrayBuffer()));
      at = end;
      if (onProgress) onProgress(at, blob.size);
      while (queue.length) yield queue.shift();
    }
    const r = st.end();
    flushMesh(); flushSticks(); flushPts();
    while (queue.length) yield queue.shift();

    summary.warnings = r.warnings; summary.warningsSuppressed = r.warningsSuppressed;
    summary.header = r.header;
    summary.meshColor = meshColor || null;
    for (const k of ['strings', 'points']) {
      const t = cats[k];
      summary[k].categories = t.overflow || !t.names.length ? null : t.names.slice();
      summary[k].catColors = summary[k].categories ? t.colors.slice() : null;
    }
    summary.kinds = [summary.counts.triangles && 'mesh', summary.counts.segments && 'strings', summary.counts.points && 'points'].filter(Boolean);
    summary.done = true;
  }

  return { header, batches, summary };
}
