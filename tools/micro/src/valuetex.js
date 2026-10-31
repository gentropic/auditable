// micro valuetex — a column's value for EVERY record, as a GPU texture: one R32F
// texel per record, 8192-wide rows, the layout condenser's setLayerChanTex reads
// (the same record addressing as the filter mask and the rule codes).
//
// Why: colouring a block model by a column the chunks weren't built with used to
// re-stream the whole file and rebuild every chunk (17–19 s at 60M blocks) just to
// change one number per block. Now only that column is read — on the worker pool
// for Parquet and .dm (src/colscan.js), from the pin cache when it's resident, or
// by the row path for CSV — and each piece goes to the GPU as it arrives, so the
// page never holds the whole column either. GPU cost: 4 bytes a record.
//
// buildValueTexture(L, gl, expr, { onProgress, signal }) → { tex, range: [lo, hi],
// finite, where } | null when the texture can't hold the layer (too many records
// for the GPU's texture size, or the allocation failed) — the caller re-streams.
// A blank is written as BLANK, which every ramp clamps to its lowest colour (the
// chunk path quantized blanks to the chunk's minimum: the same lowest colour).
import { scanColumnar, canScanColumnar } from './colscan.js';
import { layerTableHeader, schemaExt, layerRecords, numOf, attrRowCountOf } from './records.js';
import { pinGet } from './columns.js';
import { compileValue, parse } from '../../../ext/expr/index.js';

export const TEX_W = 8192;
export const BLANK = -3.0e38;

// the column a plain quoted name refers to, or null for an expression
function nameOf(expr) { try { const a = parse(expr); return a && a.t === 'field' ? a.name : null; } catch { return null; } }

export async function buildValueTexture(L, gl, expr, { onProgress = null, signal = null } = {}) {
  const columnar = canScanColumnar(L);
  const h = layerTableHeader(L); if (!h) return null;
  const n = columnar ? h.count : (attrRowCountOf(L) || 0);
  if (!n) return null;
  const H = Math.ceil(n / TEX_W);
  if (H > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return null;
  while (gl.getError() !== gl.NO_ERROR) { /* drain stale errors */ }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, TEX_W, H);
  if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(tex); return null; }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  // a run of records [start, start + v.length) → the texture: a partial first row,
  // the whole rows, a partial last row
  const upload = (v, start) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    let i = 0, at = start;
    while (i < v.length) {
      const x = at % TEX_W, y = (at - x) / TEX_W;
      if (x || v.length - i < TEX_W) {
        const k = Math.min(v.length - i, TEX_W - x);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, k, 1, gl.RED, gl.FLOAT, v.subarray(i, i + k));
        i += k; at += k;
      } else {
        const rows = Math.floor((v.length - i) / TEX_W);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, TEX_W, rows, gl.RED, gl.FLOAT, v.subarray(i, i + rows * TEX_W));
        i += rows * TEX_W; at += rows * TEX_W;
      }
    }
  };
  let lo = Infinity, hi = -Infinity, finite = 0, where = 'on this page';
  // the coordinate columns: a record without all three isn't drawn, so its value
  // stays out of the range (CSV's row path numbers only drawn records already)
  const m = h.mapping || {};
  // — read only when the layer HAS such records (the open counted what it drew)
  const bd = L.docs.blockDoc, undrawn = !bd || bd.drawn == null || bd.drawn < n;
  const coords = columnar && undrawn && m.x != null && m.y != null && m.z != null ? [h.columns[m.x], h.columns[m.y], h.columns[m.z]] : null;
  // Float64 values → Float32 + blanks → upload; the range over DRAWN records
  // (finite coordinates) when the coordinates are at hand
  const take = (V, start, C = null) => {
    const v = new Float32Array(V.length);
    for (let i = 0; i < V.length; i++) {
      const x = V[i];
      if (!Number.isFinite(x)) { v[i] = BLANK; continue; }
      v[i] = x;
      if (C && !(Number.isFinite(C[0][i]) && Number.isFinite(C[1][i]) && Number.isFinite(C[2][i]))) continue;
      if (x < lo) lo = x; if (x > hi) hi = x; finite++;
    }
    upload(v, start);
  };
  const abort = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
  try {
    const nm = nameOf(expr), pin = nm ? pinGet(L, nm) : null;
    const pc = coords && coords.map((c) => pinGet(L, c));
    if (pin && pin.data && pin.data.length >= n && (!coords || pc.every((e) => e && e.data && e.data.length >= n))) {   // resident already: no read at all
      where = 'from memory';
      const W = 1 << 20;
      for (let s = 0; s < n; s += W) {
        if (signal && signal.aborted) throw abort();
        const e = Math.min(n, s + W);
        take(pin.data.subarray(s, e), s, pc && pc.map((q) => q.data.subarray(s, e)));
        if (onProgress) onProgress(Math.min(n, s + W), n, where);
        await new Promise((z) => setTimeout(z));
      }
    } else if (columnar) {
      const r = await scanColumnar(L, { kernel: 'values', params: { expr, blank: BLANK, coords }, exprs: [expr], extraCols: coords || [], signal,
        onProgress: (d, N, w) => { where = w; if (onProgress) onProgress(d, N, w); },
        onPart: (g, part, start) => {
          upload(part.v, start); finite += part.finite;
          if (part.finite) { if (part.lo < lo) lo = part.lo; if (part.hi > hi) hi = part.hi; }
        } });
      where = r.where;
    } else {                                                // CSV: the row path, numbered as the RENDERER numbers
      // layerRecords, not layerRows: a row whose coordinates don't read as numbers
      // is no block and no record, so every record after it would otherwise take
      // its neighbour's value (the record-numbering twin of 2026-08)
      const fn = compileValue(expr, schemaExt(L, h), { decimal: '.' });
      const W = 1 << 16;
      let buf = new Float64Array(W), fill = 0, start = 0, rec = 0;
      for await (const { f } of layerRecords(L, null)) {
        if (signal && signal.aborted) throw abort();
        if (rec >= n) break;
        let x; try { x = numOf(fn(f)); } catch { x = NaN; }
        buf[fill++] = x; rec++;
        if (fill === W) {
          take(buf, start); start += W; fill = 0;
          if (onProgress) onProgress(rec, n, where);
          await new Promise((z) => setTimeout(z));
        }
      }
      if (fill) take(buf.subarray(0, fill), start);
    }
  } catch (e) { gl.deleteTexture(tex); throw e; }
  if (!finite) { lo = 0; hi = 0; }
  return { tex, range: [lo, hi], finite, where, records: n };
}

