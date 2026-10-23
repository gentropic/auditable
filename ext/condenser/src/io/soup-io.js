// @gcu/condenser — the streaming triangle-soup PROVIDER (io): openPlySoup
// walks a photogrammetry-scale PLY in two passes, neither holding the file,
// and emits RawChunk batches for core/soup-geom's builder. The geometry
// discipline (Morton, shuffle, quantize) lives in core/soup-geom.js.

import { parsePlyHeader } from './ply.js';
import { emitBatch } from '../core/soup-geom.js';
import { readMSHLayout } from '../../../msh/msh.js';

// ── byte-level text walking (OBJ, ASCII PLY): no per-line strings, no whole read ──
const SLAB = 8 << 20;
const POW10 = []; for (let i = 0; i <= 22; i++) POW10.push(Number('1e' + i));
function slowNum(b, s, e) { let t = ''; for (let i = s; i < e; i++) t += String.fromCharCode(b[i]); return parseFloat(t); }
// parseFloat over bytes [s,e): exact for ≤15 significant digits (one correctly
// rounded op), parseFloat itself for exponents / long mantissas
function numAt(b, s, e) {
  let i = s, neg = false;
  if (b[i] === 45 || b[i] === 43) { neg = b[i] === 45; i++; }
  let mant = 0, sig = 0, exp = 0, dot = false, digits = 0;
  for (; i < e; i++) {
    const c = b[i];
    if (c >= 48 && c <= 57) { digits++; if (sig || c !== 48) { if (++sig > 15) return slowNum(b, s, e); } mant = mant * 10 + (c - 48); if (dot) exp--; }
    else if (c === 46 && !dot) dot = true;
    else return slowNum(b, s, e);
  }
  if (!digits || -exp > 22) return slowNum(b, s, e);
  const v = exp ? mant / POW10[-exp] : mant;
  return neg ? -v : v;
}
// blob[from, to) in ~8 MB slabs, each cut at its last newline (the tail rides into
// the next slab): yields { b, base, n } where b[0..n) holds only complete lines
// and base is b[0]'s file offset. Per-SLAB, not per-line — a promise per line
// would cost more than parsing the line.
async function* lineSlabs(blob, from, to, { onProgress, signal, slab = SLAB } = {}) {
  let at = from, carry = null, carryAbs = 0;
  while (at < to) {
    if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const end = Math.min(to, at + slab);
    let b = new Uint8Array(await blob.slice(at, end).arrayBuffer()), base = at;
    if (carry) { const m = new Uint8Array(carry.length + b.length); m.set(carry); m.set(b, carry.length); b = m; base = carryAbs; carry = null; }
    at = end;
    let n = b.length;
    if (at < to) {
      n = b.lastIndexOf(10) + 1;
      if (n < b.length) { carry = b.slice(n); carryAbs = base + n; }
    }
    if (onProgress) onProgress(at, to);
    yield { b, base, n };
  }
}
// the lines of one slab: onLine(b, start, end, absStart) — end excludes \r\n; → false stops
function forLines({ b, base, n }, onLine) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (b[i] !== 10) continue;
    if (onLine(b, s, i > s && b[i - 1] === 13 ? i - 1 : i, base + s) === false) return false;
    s = i + 1;
  }
  if (s < n && onLine(b, s, n, base + s) === false) return false;
  return true;
}
async function eachLine(blob, from, to, onLine, opts) {
  for await (const sl of lineSlabs(blob, from, to, opts)) if (forLines(sl, onLine) === false) return;
}
// whitespace-separated tokens of one line → calls tok(s, e) in order
function tokens(b, s, e, tok) {
  let i = s;
  while (i < e) {
    while (i < e && (b[i] === 32 || b[i] === 9)) i++;
    if (i >= e) break;
    const t = i;
    while (i < e && b[i] !== 32 && b[i] !== 9) i++;
    if (tok(t, i) === false) return;
  }
}

// the vertex table every soup provider builds: local f32 against the first
// vertex (mm at UTM magnitudes), plus the world bbox — 12 B/vertex, transient
export function soupVertexTable(cap = 1 << 16) {
  let verts = new Float32Array(3 * cap), n = 0;
  const vo = [0, 0, 0], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  return {
    push(X, Y, Z) {
      if (n === 0) { vo[0] = X; vo[1] = Y; vo[2] = Z; }
      if (3 * n === verts.length) { const g = new Float32Array(verts.length * 2); g.set(verts); verts = g; }
      verts[3 * n] = X - vo[0]; verts[3 * n + 1] = Y - vo[1]; verts[3 * n + 2] = Z - vo[2];
      if (X < min[0]) min[0] = X; if (X > max[0]) max[0] = X;
      if (Y < min[1]) min[1] = Y; if (Y > max[1]) max[1] = Y;
      if (Z < min[2]) min[2] = Z; if (Z > max[2]) max[2] = Z;
      n++;
    },
    get n() { return n; }, get verts() { return verts; }, vo, min, max,
  };
}
// triangle index batches → RawChunk batches (the createSoupChunkBuilder contract)
export function soupTriBatcher(vt, batchTris) {
  const ia = new Uint32Array(batchTris), ib = new Uint32Array(batchTris), ic = new Uint32Array(batchTris);
  let n = 0, tris = 0, dropped = 0;
  const out = [];
  return {
    tri(a, b, c) {
      const nv = vt.n;
      if (a < 0 || b < 0 || c < 0 || a >= nv || b >= nv || c >= nv) { dropped++; return; }
      ia[n] = a; ib[n] = b; ic[n] = c;
      if (++n === batchTris) { out.push(emitBatch(vt.verts, vt.vo, ia, ib, ic, n)); tris += n; n = 0; }
    },
    flush() { if (n) { out.push(emitBatch(vt.verts, vt.vo, ia, ib, ic, n)); tris += n; n = 0; } },
    take() { return out.splice(0); },
    get tris() { return tris; }, get dropped() { return dropped; },
  };
}

/**
 * openObjSoup(blob) — a Wavefront OBJ too big to read whole, as a STREAMED soup.
 * Two passes, neither holding the file: (1) `v` lines → the local-f32 vertex table
 * + bbox, (2) `f` lines (fanned; v, v/vt, v//vn, v/vt/vn; negative = relative to the
 * vertices seen so far) → RawChunk batches. Groups/materials are not split here
 * (a split of a multi-GB OBJ would rewrite it); that's the context tier's job.
 */
export async function openObjSoup(blob, { onProgress, slab = SLAB } = {}) {
  const vt = soupVertexTable();
  await eachLine(blob, 0, blob.size, (b, s, e) => {
    while (s < e && (b[s] === 32 || b[s] === 9)) s++;
    if (b[s] !== 118 || (b[s + 1] !== 32 && b[s + 1] !== 9)) return;   // "v "
    const v = [];
    tokens(b, s + 2, e, (t0, t1) => { v.push(numAt(b, t0, t1)); return v.length < 3; });
    vt.push(v[0], v[1], v[2] || 0);
  }, { onProgress, slab });
  if (!vt.n) throw new Error('obj: no v lines');
  const header = { kind: 'mesh', soup: true, format: 'obj', vertexCount: vt.n, triCount: 0, bbox: { min: vt.min, max: vt.max } };

  async function* streamChunks({ batchTris = 1 << 16, signal, onProgress: op2 } = {}) {
    const tb = soupTriBatcher(vt, batchTris);
    let seenV = 0;
    const ix = [];
    const onLine = (b, s, e) => {
      while (s < e && (b[s] === 32 || b[s] === 9)) s++;
      if (b[s] === 118 && (b[s + 1] === 32 || b[s + 1] === 9)) { seenV++; return; }
      if (b[s] !== 102 || (b[s + 1] !== 32 && b[s + 1] !== 9)) return;   // "f "
      ix.length = 0;
      tokens(b, s + 2, e, (t0, t1) => {
        let i = t0, neg = false, v = 0, any = false;
        if (b[i] === 45) { neg = true; i++; }
        for (; i < t1 && b[i] >= 48 && b[i] <= 57; i++) { v = v * 10 + (b[i] - 48); any = true; }
        if (!any || v === 0) return;
        ix.push(neg ? seenV - v : v - 1);
      });
      for (let k = 2; k < ix.length; k++) tb.tri(ix[0], ix[k - 1], ix[k]);
    };
    for await (const sl of lineSlabs(blob, 0, blob.size, { signal, onProgress: op2, slab })) {
      forLines(sl, onLine);
      yield* tb.take();                                     // batches leave per slab — nothing accumulates
    }
    tb.flush();
    yield* tb.take();
    header.triCount = tb.tris;
    header.dropped = tb.dropped;
  }
  return { header, streamChunks };
}

/**
 * openPlySoup(blob) — the TRUE streaming provider (binary_le + ascii PLY, the
 * formats photogrammetry exports). Two passes over the blob, neither holding
 * the file: (1) the vertex block → local-f32 xyz (12 B/vertex transient RAM —
 * the honest open-time cost; freed when streaming ends), (2) the face block
 * walked in slabs, fanned, emitted as RawChunk batches.
 * → { header, streamChunks } — header = { kind:'mesh', soup:true, format,
 *    vertexCount, triCount(≈ faces, exact after stream), bbox }
 */
export async function openPlySoup(blob, { onProgress, slab = SLAB } = {}) {
  let sampleLen = 64 * 1024, ply = null;
  for (;;) {
    const text = new TextDecoder('latin1').decode(await blob.slice(0, Math.min(sampleLen, blob.size)).arrayBuffer());
    ply = parsePlyHeader(text);
    if (ply) break;
    if (sampleLen >= blob.size) throw new Error('ply: no end_header');
    sampleLen *= 4;
  }
  const face = ply.elements.find((e) => e.name === 'face');
  if (!face || !face.count) throw new Error('ply: no face element');
  const px = ply.props.find((p) => p.name.toLowerCase() === 'x');
  const py = ply.props.find((p) => p.name.toLowerCase() === 'y');
  const pz = ply.props.find((p) => p.name.toLowerCase() === 'z');
  if (!px || !py || !pz) throw new Error('ply: vertex needs x/y/z');
  const nv = ply.count, ascii = ply.format === 'ascii';
  const SIZES = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const GETTERS = { 1: 'getUint8', 2: 'getUint16', 4: 'getUint32' };

  // ── pass 1: vertices → local f32 (+ bbox in world f64) ──
  const verts = new Float32Array(3 * nv);
  const vo = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let faceStart;                                            // byte offset where faces begin (binary) / line index (ascii)
  if (!ascii) {
    const SLAB = 1 << 23;                                   // 8 MB windows
    let seen = 0;
    while (seen < nv) {
      const n = Math.min(Math.floor(SLAB / ply.stride) || 1, nv - seen);
      const off = ply.dataOffset + seen * ply.stride;
      const dv = new DataView(await blob.slice(off, off + n * ply.stride).arrayBuffer());
      for (let i = 0; i < n; i++) {
        const X = dv[px.getter](i * ply.stride + px.offset, true);
        const Y = dv[py.getter](i * ply.stride + py.offset, true);
        const Z = dv[pz.getter](i * ply.stride + pz.offset, true);
        if (seen === 0 && i === 0) { vo[0] = X; vo[1] = Y; vo[2] = Z; }
        const k = (seen + i) * 3;
        verts[k] = X - vo[0]; verts[k + 1] = Y - vo[1]; verts[k + 2] = Z - vo[2];
        if (X < min[0]) min[0] = X; if (X > max[0]) max[0] = X;
        if (Y < min[1]) min[1] = Y; if (Y > max[1]) max[1] = Y;
        if (Z < min[2]) min[2] = Z; if (Z > max[2]) max[2] = Z;
      }
      seen += n;
      if (onProgress) onProgress(off + n * ply.stride, blob.size);
    }
    faceStart = ply.dataOffset + nv * ply.stride;
  } else {
    // ascii: the vertex lines walked in slabs (never one string — an ascii
    // photogrammetry export can be gigabytes); faceStart = the byte offset of the
    // first line after the nv-th vertex
    const xi = ply.props.indexOf(px), yi = ply.props.indexOf(py), zi = ply.props.indexOf(pz);
    const need = Math.max(xi, yi, zi);
    const f = new Float64Array(need + 1);
    let rec = 0;
    faceStart = blob.size;
    await eachLine(blob, ply.dataOffset, blob.size, (b, s, e, abs) => {
      if (rec >= nv) { faceStart = abs; return false; }
      let k = 0, any = false;
      tokens(b, s, e, (t0, t1) => { any = true; if (k <= need) f[k] = numAt(b, t0, t1); k++; return k <= need; });
      if (!any) return;                                     // blank line
      const X = f[xi], Y = f[yi], Z = f[zi];
      if (rec === 0) { vo[0] = X; vo[1] = Y; vo[2] = Z; }
      verts[rec * 3] = X - vo[0]; verts[rec * 3 + 1] = Y - vo[1]; verts[rec * 3 + 2] = Z - vo[2];
      if (X < min[0]) min[0] = X; if (X > max[0]) max[0] = X;
      if (Y < min[1]) min[1] = Y; if (Y > max[1]) max[1] = Y;
      if (Z < min[2]) min[2] = Z; if (Z > max[2]) max[2] = Z;
      rec++;
    }, { onProgress: onProgress ? (a) => onProgress(a, blob.size) : null, slab });
  }

  const header = {
    kind: 'mesh', soup: true, format: ascii ? 'ply-ascii' : 'ply-binary',
    vertexCount: nv, triCount: face.count, faces: face.count,
    bbox: { min, max },
  };

  // ── pass 2: the face walk → RawChunk batches ──
  async function* streamChunks({ batchTris = 1 << 16, signal, onProgress: op2 } = {}) {
    const ia = new Uint32Array(batchTris), ib = new Uint32Array(batchTris), ic = new Uint32Array(batchTris);
    let n = 0, tris = 0;
    const flushTo = function* (force) {
      if (n && (force || n === batchTris)) { const b = emitBatch(verts, vo, ia, ib, ic, n); tris += n; n = 0; yield b; }
    };
    const pushFan = function* (ix, k) {
      for (let j = 2; j < k; j++) {
        ia[n] = ix[0]; ib[n] = ix[j - 1]; ic[n] = ix[j];
        n++;
        if (n === batchTris) yield* flushTo(true);
      }
    };
    if (!ascii) {
      const MAXREC = 4 + 255 * 8;                           // count + a generous n-gon
      const SLAB = 1 << 23;
      let base = faceStart, carry = new Uint8Array(0), done = 0;
      const ix = new Uint32Array(256);
      while (done < face.count && base < blob.size) {
        if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const take = Math.min(SLAB, blob.size - base);
        const slab = new Uint8Array(carry.length + take);
        slab.set(carry, 0);
        slab.set(new Uint8Array(await blob.slice(base, base + take).arrayBuffer()), carry.length);
        base += take;
        const dv = new DataView(slab.buffer);
        let off = 0;
        const last = base >= blob.size;
        while (done < face.count && (last ? off < slab.length : off + MAXREC <= slab.length)) {
          let rOff = off, bad = false;
          for (const pr of face.props) {
            if (pr.list) {
              const cs = SIZES[pr.countType] || 1, is = SIZES[pr.idxType] || 4;
              if (rOff + cs > slab.length) { bad = true; break; }
              const k = dv[GETTERS[cs]](rOff, true); rOff += cs;
              if (rOff + k * is > slab.length) { bad = true; break; }
              if (/vertex_ind/i.test(pr.name) || face.props.length === 1) {
                for (let j = 0; j < k; j++) ix[j] = dv[GETTERS[is]](rOff + j * is, true);
                rOff += k * is;
                yield* pushFan(ix, k);
              } else rOff += k * is;
            } else {
              rOff += SIZES[pr.type] || 4;
              if (rOff > slab.length) { bad = true; break; }
            }
          }
          if (bad) break;
          off = rOff;
          done++;
        }
        carry = slab.subarray(off);
        if (op2) op2(base, blob.size);
      }
    } else {
      // face lines in slabs: "k i0 i1 … i(k-1) [other props]" — the vertex list leads
      let fc = 0;
      const ix = new Uint32Array(256);
      const ready = [];
      for await (const sl of lineSlabs(blob, faceStart, blob.size, { signal, slab })) {
        forLines(sl, (b, s, e) => {
          if (fc >= face.count) return false;
          let k = -1, j = 0;
          tokens(b, s, e, (t0, t1) => {
            const v = numAt(b, t0, t1);
            if (k < 0) { k = Math.min(255, v | 0); return k > 0; }
            ix[j++] = v;
            return j < k;
          });
          if (k < 0) return;                                // blank line
          for (const x of pushFan(ix, k)) ready.push(x);
          fc++;
        });
        while (ready.length) yield ready.shift();
        if (op2) op2(sl.base + sl.n, blob.size);
        if (fc >= face.count) break;
      }
    }
    yield* flushTo(true);
    header.triCount = tris + n;                             // exact after the stream (fans expand quads)
  }

  return { header, streamChunks };
}

/**
 * openMshSoup(blob) — a Leapfrog .msh too big for the context tier, STREAMED.
 * The text index names each array's offset (readMSHLayout reads only the head),
 * so: (1) the Location array in 8 MB slices → the local-f32 vertex table + bbox,
 * (2) the Tri array in slices → RawChunk batches. Out-of-range indices are
 * dropped and counted (readMSH throws on them; a stream reports instead).
 */
export async function openMshSoup(blob, { onProgress, slab = SLAB } = {}) {
  const lay = await readMSHLayout(blob);
  if (!lay.vertices || !lay.triangles) throw new Error('msh: no vertex/triangle arrays found');
  const V = lay.vertices, T = lay.triangles;
  const vt = soupVertexTable(V.count);
  const VREC = 24, per = Math.max(1, Math.floor(slab / VREC));
  for (let i = 0; i < V.count; i += per) {
    const n = Math.min(per, V.count - i);
    const dv = new DataView(await blob.slice(V.offset + i * VREC, V.offset + (i + n) * VREC).arrayBuffer());
    for (let k = 0; k < n; k++) vt.push(dv.getFloat64(k * VREC, true), dv.getFloat64(k * VREC + 8, true), dv.getFloat64(k * VREC + 16, true));
    if (onProgress) onProgress(V.offset + (i + n) * VREC, blob.size);
  }
  const header = { kind: 'mesh', soup: true, format: 'msh', vertexCount: V.count, triCount: T.count, bbox: { min: vt.min, max: vt.max } };

  async function* streamChunks({ batchTris = 1 << 16, signal, onProgress: op2 } = {}) {
    const tb = soupTriBatcher(vt, batchTris);
    const TREC = 12, tper = Math.max(1, Math.floor(slab / TREC));
    for (let i = 0; i < T.count; i += tper) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const n = Math.min(tper, T.count - i);
      const dv = new DataView(await blob.slice(T.offset + i * TREC, T.offset + (i + n) * TREC).arrayBuffer());
      for (let k = 0; k < n; k++) tb.tri(dv.getInt32(k * TREC, true), dv.getInt32(k * TREC + 4, true), dv.getInt32(k * TREC + 8, true));
      yield* tb.take();
      if (op2) op2(T.offset + (i + n) * TREC, blob.size);
    }
    tb.flush();
    yield* tb.take();
    header.triCount = tb.tris;
    header.dropped = tb.dropped;
  }
  return { header, streamChunks };
}

