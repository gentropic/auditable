// micro × .wfr — writing. ONE path from "something micro can read" to a .wfr element, shared by
// File → Convert to .wfr (source files, never loaded as layers), Export → .wfr (loaded layers) and
// project saving. All of it goes through @gcu/wireframe's streaming writer: bounded memory, spilling
// to OPFS beyond a budget, output independent of the budget.
//
//   PLY / OBJ / DXF        → wireframe's streamed adapters (indexed meshes keep their attributes;
//                            DXF triangles/strings/points keep layer + colour; soup is welded)
//   .msh / .lfm / .dm pair → micro's own readers (condenser, @gcu/lfm), indexed
//   .wfr                   → its elements, re-encoded (indexed when they fit the context tier)
//   a loaded context mesh  → its resident vertices + triangles + vertex columns, indexed
//   anything streamed      → its source, converted, keeping only that layer's kind of element
import { createWfrWriter, opfsBacking, attrType } from '../../../ext/wireframe/index.js';
import { convertPly, convertObj, convertDxf } from '../../../ext/wireframe/convert.js';
import { createSceneStream, openMsh, openMshSoup, readMSHLayout, openDmWireframe } from '../../../ext/condenser/src/main.js';
import { readLFM } from '../../../ext/lfm/lfm.js';
import { reReadMesh } from './records.js';
import { isWfrName, openWfrBlob, wfrResidentMesh, wfrSoupDoc, wfrStringsDoc, wfrPointsDoc } from './wfr-io.js';

const CONTEXT_TRI_CAP = 2_000_000;
const SLAB = 8 << 20;
const abortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
export const WFR_SOURCE_RE = /\.(ply|obj|dxf|msh|lfm|dm|wfr)$/i;
export const baseName = (n) => String(n || 'mesh').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

// a Blob as a stream of byte slabs (works for any Blob-shaped source, incl. the shell's fileBlob)
async function* blobChunks(blob, { onBytes, signal } = {}) {
  for (let at = 0; at < blob.size; at += SLAB) {
    if (signal && signal.aborted) throw abortError();
    const end = Math.min(blob.size, at + SLAB);
    const u = new Uint8Array(await blob.slice(at, end).arrayBuffer());
    if (onBytes) onBytes(end);
    yield u;
  }
}

// A writer view that (a) renames duplicate element names and (b) drops elements of unwanted kinds,
// so a source can be converted "keeping only its strings" without the adapter knowing.
function scopedWriter(wr, { only = null, prefix = null } = {}) {
  const NULL = { label: () => 0, vertices: async () => {}, cells: async () => {}, soup: async () => {}, points: async () => {} };
  return {
    element(spec) {
      if (only && spec.kind !== only) return NULL;
      let name = prefix && spec.name !== prefix && !spec.name.startsWith(prefix + ':') ? `${prefix}:${spec.name}` : spec.name;
      const taken = new Set(wr.names());
      if (taken.has(name)) { let i = 2; while (taken.has(`${name} (${i})`)) i++; name = `${name} (${i})`; }
      return wr.element({ ...spec, name });
    },
  };
}

// PLY's conventional property names → the format's reserved attribute names (SPEC §8), the same
// mapping wireframe's PLY adapter applies, so a .wfr names colour/normals one way whichever path wrote it
const RESERVED_NAME = { red: 'color.r', green: 'color.g', blue: 'color.b', alpha: 'color.a', nx: 'normal.x', ny: 'normal.y', nz: 'normal.z' };

// numeric typed-array attributes only (strings/objects are skipped), as { name: type } + arrays
function numericAttrs(attrs) {
  const types = {}, arrays = {};
  for (const [n0, a] of Object.entries(attrs || {})) {
    const n = RESERVED_NAME[n0] || n0;
    if (!ArrayBuffer.isView(a) || a instanceof BigInt64Array || a instanceof BigUint64Array) continue;
    let t;
    try { t = attrType(a); } catch { continue; }
    if (a instanceof Uint32Array) { types[n] = 'f64'; arrays[n] = Float64Array.from(a); continue; }
    types[n] = t; arrays[n] = a;
  }
  return { types, arrays };
}

// one indexed triangles element from resident arrays
async function indexedElement(w, { name, vertices, triangles, attrs, spec = {}, meta = {} }) {
  const { types, arrays } = numericAttrs(attrs);
  const el = w.element({ ...spec, name, kind: 'triangles', vertexAttributes: types, meta: { ...(spec.meta || {}), ...meta } });
  await el.vertices(vertices, arrays);
  await el.cells(triangles instanceof Uint32Array ? triangles : Uint32Array.from(triangles));
}

// soup RawChunks { count, ax..cz } → writer.soup (welded by position)
async function soupElement(w, { name, chunks, spec = {}, meta = {}, signal }) {
  const el = w.element({ ...spec, name, kind: 'triangles', meta: { ...(spec.meta || {}), ...meta } });
  for await (const r of chunks) {
    if (signal && signal.aborted) throw abortError();
    const n = r.count, P = new Float64Array(9 * n);
    for (let i = 0; i < n; i++) {
      P[9 * i] = r.ax[i]; P[9 * i + 1] = r.ay[i]; P[9 * i + 2] = r.az[i];
      P[9 * i + 3] = r.bx[i]; P[9 * i + 4] = r.by[i]; P[9 * i + 5] = r.bz[i];
      P[9 * i + 6] = r.cx[i]; P[9 * i + 7] = r.cy[i]; P[9 * i + 8] = r.cz[i];
    }
    await el.soup(P);
  }
}

/**
 * writeSource(wr, src, opts) — one source (files[] + a display name) into the writer.
 *   src: { files: [Blob…] (a Datamine pair is [points, triangles]), name }
 *   opts: { spec (coords / topology / target), only ('triangles'|'lines'|'points'), element (a .wfr's),
 *           onBytes(read, total), signal }
 */
export async function writeSource(wr, src, opts = {}) {
  const { spec = {}, only = null, signal } = opts;
  const name = baseName(src.name || src.files[0].name);
  const blob = src.files[src.files.length - 1];
  const fname = (src.name || blob.name || '').toLowerCase();
  const w = scopedWriter(wr, { only });
  const onBytes = opts.onBytes ? (n) => opts.onBytes(n, blob.size) : null;
  const meta = { lineage: { op: 'convert', source: src.files.map((f) => f.name || name), tool: 'micro' } };
  const withMeta = { ...spec, meta: { ...(spec.meta || {}), ...meta } };
  if (src.files.length === 2) {                                   // Datamine pt/tr pair → one welded mesh
    const m = await openDmWireframe(src.files[0], src.files[1]);
    return indexedElement(w, { name, vertices: m.vertices, triangles: m.triangles, spec, meta });
  }
  if (/\.ply$/.test(fname)) return convertPly(blobChunks(blob, { onBytes, signal }), w, { name, spec: withMeta });
  if (/\.obj$/.test(fname)) return convertObj(blobChunks(blob, { onBytes, signal }), w, { name, spec: withMeta });
  if (/\.dxf$/.test(fname)) return convertDxf(blobChunks(blob, { onBytes, signal }), w, { name, spec: withMeta, dxf: { createSceneStream } });
  if (/\.msh$/.test(fname)) {
    const lay = await readMSHLayout(blob);
    if (((lay.triangles || { count: 0 }).count) <= CONTEXT_TRI_CAP) {
      const m = await openMsh(blob);
      return indexedElement(w, { name, vertices: m.vertices, triangles: m.triangles, spec, meta });
    }
    const doc = await openMshSoup(blob);
    return soupElement(w, { name, chunks: doc.streamChunks({ batchTris: 1 << 16 }), spec, meta, signal });
  }
  if (/\.lfm$/.test(fname)) {                                     // every Leapfrog mesh its own element, colour kept
    const r = await readLFM(blob);
    for (const m of r.meshes) {
      if (signal && signal.aborted) throw abortError();
      const c = m.colour;
      await indexedElement(w, { name: r.meshes.length > 1 ? `${name}:${m.name}` : (m.name || name), vertices: m.vertices, triangles: m.triangles, spec, meta: { ...meta, ...(c ? { tint: [c.r, c.g, c.b] } : {}) } });
    }
    return;
  }
  if (isWfrName(fname)) {                                         // re-encode a .wfr's elements
    const wfr = await openWfrBlob(blob);
    for (const el of wfr.elements) {
      if (opts.element != null && el.name !== opts.element) continue;
      if (only && el.kind !== only) continue;
      if (signal && signal.aborted) throw abortError();
      const elMeta = { ...meta, ...(el.meta.meta || {}) };
      const topo = el.meta.topology && el.meta.topology.status === 'checked' && spec.topology !== 'check' ? { topology: el.meta.topology } : {};
      if (el.kind === 'triangles') {
        if (el.meta.counts.cells <= CONTEXT_TRI_CAP) {
          const m = await wfrResidentMesh(el);
          await indexedElement(w, { name: el.name, vertices: m.vertices, triangles: m.triangles, attrs: m.attrs, spec: { ...spec, ...topo }, meta: elMeta });
        } else await soupElement(w, { name: el.name, chunks: wfrSoupDoc(el).streamChunks(), spec, meta: elMeta, signal });
      } else if (el.kind === 'lines') {
        const d = wfrStringsDoc(el);
        const ord = d.header.polylines;   // line + seq survive the re-encode; a plain network has neither
        const lw = w.element({ ...spec, name: el.name, kind: 'lines', cellAttributes: { layer: 'string', ...(ord ? { line: 'i32', seq: 'i32' } : {}) }, meta: elMeta });
        for await (const r of d.streamChunks()) {
          const n = r.count, P = new Float64Array(6 * n), layer = new Array(n), sid = new Int32Array(n), sq = new Int32Array(n);
          for (let i = 0; i < n; i++) {
            P.set([r.ax[i], r.ay[i], r.az[i], r.bx[i], r.by[i], r.bz[i]], 6 * i);
            const rec = d.fetchRecord(r.recIdx[i]); layer[i] = rec[0]; sid[i] = rec[1]; sq[i] = rec[2];
          }
          await lw.soup(P, { layer, ...(ord ? { line: sid, seq: sq } : {}) });
        }
      } else {
        const d = wfrPointsDoc(el);
        const pw = w.element({ ...spec, name: el.name, kind: 'points', vertexAttributes: { layer: 'string' }, meta: elMeta });
        for await (const r of d.streamChunks()) {
          const n = r.count, P = new Float64Array(3 * n), layer = new Array(n);
          for (let i = 0; i < n; i++) { P[3 * i] = r.x[i]; P[3 * i + 1] = r.y[i]; P[3 * i + 2] = r.z[i]; layer[i] = d.fetchRecord(r.recIdx[i])[3]; }
          await pw.points(P, { layer });
        }
      }
    }
    return;
  }
  throw new Error(`can't convert ${src.name || blob.name} to .wfr (reads ${WFR_SOURCE_RE.source.replace(/[\\()$/i]/g, '').replace(/\|/g, ' .').replace(/^\./, '.')})`);
}

/**
 * writeLayer(wr, L, opts) — one loaded layer into the writer.
 *   context mesh → indexed, with its vertex columns, tint and lineage
 *   streamed mesh / strings / pegs → the layer's source, keeping that kind only
 */
export async function writeLayer(wr, L, opts = {}) {
  const { spec = {} } = opts;
  const name = baseName(L.label || L.name);
  const meta = { lineage: L.lineage || null, ...(L.tint ? { tint: L.tint } : {}) };
  const md = L.docs && L.docs.meshDoc, sd = L.docs && L.docs.stringsDoc;
  if (md && !md.header.soup) {
    const m = await reReadMesh(md);
    const topo = md.header.topology && md.header.topology.status === 'checked' && spec.topology !== 'check' ? { topology: md.header.topology } : {};
    return indexedElement(scopedWriter(wr), { name, vertices: m.vertices, triangles: m.triangles, attrs: m.attrs, spec: { ...spec, ...topo }, meta });
  }
  const only = md ? 'triangles' : sd ? (sd.header.kind === 'strings' ? 'lines' : 'points') : null;
  if (!only) throw new Error(`${L.label || L.name}: only meshes, strings and points export to .wfr`);
  const src = md && md.header.format === 'dm-wireframe' ? { files: [md.ptBlob, md.blob], name: L.name } : { files: [(md || sd).blob], name: (md || sd).name || L.name };
  const element = (md || sd).header.element;
  return writeSource(wr, src, { ...opts, only, element, spec: { ...spec, meta } });
}

/**
 * runWfrJob({ sink, sources | layers, budget, spec, onProgress, signal }) → { size, manifest, stats }
 *   sink: { write(u8) } — a FileSystemWritableFileStream wrapper, or parts collected into a Blob
 *   budget: bytes kept resident (Infinity → all in memory); beyond it spills go to OPFS
 *   onProgress({ phase: 'reading'|'writing', source, bytes, total, index, count })
 */
export async function runWfrJob({ sink, sources = [], layers = [], budget = 512 * 1024 * 1024, spec = {}, onProgress, signal }) {
  const backing = Number.isFinite(budget) && typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory ? await opfsBacking() : null;
  try {
    const wr = createWfrWriter(sink, { budget: backing ? budget : Infinity, backing });
    const count = sources.length + layers.length;
    let index = 0;
    for (const src of sources) {
      const label = src.name || src.files[src.files.length - 1].name;
      if (onProgress) onProgress({ phase: 'reading', source: label, bytes: 0, total: src.files[src.files.length - 1].size, index, count });
      await writeSource(wr, src, { spec, signal, onBytes: (bytes, total) => onProgress && onProgress({ phase: 'reading', source: label, bytes, total, index, count }) });
      index++;
    }
    for (const L of layers) {
      const label = L.label || L.name;
      if (onProgress) onProgress({ phase: 'reading', source: label, bytes: 0, total: 0, index, count });
      await writeLayer(wr, L, { spec, signal, onBytes: (bytes, total) => onProgress && onProgress({ phase: 'reading', source: label, bytes, total, index, count }) });
      index++;
    }
    if (signal && signal.aborted) throw abortError();
    if (!wr.names().length) throw new Error('nothing to write — no meshes, strings or points found');
    if (onProgress) onProgress({ phase: 'writing', index: count, count });
    return await wr.finish({ meta: { tool: 'micro' } });
  } finally {
    if (backing) await backing.dispose();
  }
}

/**
 * packLayers({ sink, layers, budget, spec, signal, onProgress }) → { size, manifest, elementsOf: Map(L → [names]) }
 * Like runWfrJob over layers, but records which element(s) each layer became — the project store
 * re-opens every layer from its own element of the packed file.
 */
export async function packLayers({ sink, layers, budget = 512 * 1024 * 1024, spec = {}, signal, onProgress }) {
  const backing = Number.isFinite(budget) && typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory ? await opfsBacking() : null;
  try {
    const wr = createWfrWriter(sink, { budget: backing ? budget : Infinity, backing });
    const elementsOf = new Map();
    let index = 0;
    for (const L of layers) {
      if (signal && signal.aborted) throw abortError();
      const before = wr.names().length, label = L.label || L.name;
      if (onProgress) onProgress({ phase: 'reading', source: label, bytes: 0, total: 0, index, count: layers.length });
      await writeLayer(wr, L, { spec, signal, onBytes: (bytes, total) => onProgress && onProgress({ phase: 'reading', source: label, bytes, total, index, count: layers.length }) });
      elementsOf.set(L, wr.names().slice(before));
      index++;
    }
    if (onProgress) onProgress({ phase: 'writing', index, count: layers.length });
    const res = await wr.finish({ meta: { tool: 'micro', op: 'project-store' } });
    return { ...res, elementsOf };
  } finally {
    if (backing) await backing.dispose();
  }
}

// Output sinks. A file handle streams to disk (never resident); otherwise parts collect into a Blob.
export async function handleSink(fileHandle) {
  const ws = await fileHandle.createWritable();
  return { write: (u8) => ws.write(u8), close: () => ws.close(), abort: () => ws.abort().catch(() => {}) };
}
export function partsSink() {
  const parts = [];
  return { write: (u8) => { parts.push(u8.slice()); }, blob: () => new Blob(parts, { type: 'application/vnd.gentropic.wireframe' }), close: async () => {}, abort: async () => {} };
}
