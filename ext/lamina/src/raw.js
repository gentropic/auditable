// @gcu/lamina — raw: the bytes of a file as they are, as LINES or as HEX — the answer to "why
// is this being read wrong?". Both are windowed exactly like the table view (a block LRU over
// `readRange`), so a raw view of a 50 GB file costs what a table view of it costs.
//
// LINES ride a text-kind source (one block-index entry per K lines — source.js with kind 'text').
// Each row is [offset, line]: the line's byte offset in the file, and its text with the invisible
// made visible — tab ⇥, other control characters as their ␀-block glyphs, a byte-order mark, a
// no-break space ⍽, trailing spaces ·, and the line ending itself (␍␊ / ␊; nothing on a last line
// that has none). A cursor gives filter / find / export the same [offset, line] fields, so "line
// matches …" is a streaming grep. A line longer than the read window is cut and says so.
//
// HEX needs no index at all: row r is the 16 bytes at offset 16·r. Each row is [offset (hex),
// the bytes in hex, the bytes as text ('.' for the unprintable)].

import { LOADING } from './viewsource.js';

const NL = 10, CR = 13, SP = 32;

/** The text of one line with the invisible made visible. */
export function visibleText(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 9) out += '⇥';
    else if (ch < 32) out += String.fromCharCode(0x2400 + ch);       // ␀ ␁ … ␟
    else if (ch === 0x7f) out += '␡';
    else if (ch === 0xfeff) out += '⟨BOM⟩';
    else if (ch === 0xa0) out += '⍽';                                // a no-break space — the classic invisible CSV bug
    else out += text[i];
  }
  // trailing spaces are invisible and matter (a "OXIDE " that never equals "OXIDE")
  let k = out.length; while (k > 0 && out.charCodeAt(k - 1) === SP) k--;
  return k < out.length ? out.slice(0, k) + '·'.repeat(out.length - k) : out;
}

const decoders = {};
const dec = (enc) => decoders[enc || 'utf-8'] || (decoders[enc || 'utf-8'] = new TextDecoder(enc || 'utf-8', { fatal: false }));

// Split a block's bytes into lines: [{ start, end, eol }] — end excludes the terminator, eol is
// '␍␊' | '␊' | '' (a final line without one).
function linesOf(bytes, complete) {
  const out = [];
  let s = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== NL) continue;
    const crlf = i > s && bytes[i - 1] === CR;
    out.push({ start: s, end: crlf ? i - 1 : i, eol: crlf ? '␍␊' : '␊' });
    s = i + 1;
  }
  if (s < bytes.length) out.push({ start: s, end: bytes.length, eol: '', cut: !complete });
  return out;
}

const lineText = (bytes, l, enc) => visibleText(dec(enc).decode(bytes.subarray(l.start, l.end))) + l.eol + (l.cut ? ' … (the line goes on — see hex)' : '');

/**
 * A raw-LINES view source over a text-kind source (source.js, kind 'text').
 * @param {object} src   { blockSize, blockOffsets, rowCount, totalBytes, readRange, encoding }
 * @param {object} opts  { cacheBlocks, maxBlockBytes } — a block wider than maxBlockBytes is read only
 *                       that far (its lines past the window show as cut / unread)
 */
export function createRawLinesView(src, { cacheBlocks = 8, maxBlockBytes = 8 << 20 } = {}) {
  const K = src.blockSize, enc = src.encoding;
  const cache = new Map(), inflight = new Map(), readyCbs = [];
  const notify = () => { for (const cb of readyCbs) { try { cb(); } catch (e) { console.error('[lamina] onReady threw', e); } } };
  const span = (b) => { const s = src.blockOffsets[b]; const e = b + 1 < src.blockOffsets.length ? src.blockOffsets[b + 1] : src.totalBytes; return [s, e]; };
  function loadBlock(b) {
    if (cache.has(b)) return Promise.resolve();
    if (inflight.has(b)) return inflight.get(b);
    const [s, e] = span(b), len = Math.min(e - s, maxBlockBytes);
    const p = Promise.resolve(src.readRange(s, len)).then((bytes) => {
      const ls = linesOf(bytes, len === e - s);
      const rows = ls.map((l) => [String(s + l.start), lineText(bytes, l, enc)]);
      cache.set(b, rows);
      while (cache.size > cacheBlocks) cache.delete(cache.keys().next().value);
      inflight.delete(b); notify();
    }, (err) => { inflight.delete(b); console.error('[lamina] raw block failed', err); });
    inflight.set(b, p);
    return p;
  }
  const schema = [{ name: 'offset', type: 'number' }, { name: 'line', type: 'string' }];
  return {
    kind: 'raw', cols: 2, schema,
    rowCount() { return src.rowCount; },
    rowAt(r) {
      if (r < 0 || r >= src.rowCount) return null;
      const b = Math.floor(r / K);
      if (cache.has(b)) { const rows = cache.get(b); cache.delete(b); cache.set(b, rows); return rows[r - b * K] || ['', '(in a very long stretch — not read; see hex)']; }
      loadBlock(b);
      return LOADING;
    },
    async ensureRow(r) { if (r >= 0 && r < src.rowCount) await loadBlock(Math.floor(r / K)); return this.rowAt(r); },
    header(c) { return { label: schema[c].name, type: schema[c].type }; },
    colType(c) { return schema[c].type; },
    onReady(cb) { readyCbs.push(cb); return () => { const i = readyCbs.indexOf(cb); if (i >= 0) readyCbs.splice(i, 1); }; },
  };
}

/**
 * The record cursor for raw lines (the cursor.js contract): fields = [offset, line], locator =
 * (offset, length). Filter / find / export run on it unchanged.
 */
export function installRawCursor(src, { maxBlockBytes = 8 << 20 } = {}) {
  const K = src.blockSize, enc = src.encoding, nBlocks = src.blockOffsets.length;
  const cur = {
    kind: 'raw', rowCount: src.rowCount, blockSize: K, blockOffsets: src.blockOffsets, totalBytes: src.totalBytes, readRange: src.readRange,
    async eachRecord({ dataStart = 0, rows = null, onProgress, limit = Infinity, signal } = {}, visit) {
      let sp = 0, seen = 0;
      for (let b = 0; b < nBlocks; b++) {
        if (signal && signal.aborted) throw new DOMException('Scan aborted', 'AbortError');
        if (rows) { if (sp >= rows.length) break; if (Math.floor((rows[sp] + dataStart) / K) > b) continue; }
        const s = src.blockOffsets[b], e = b + 1 < nBlocks ? src.blockOffsets[b + 1] : src.totalBytes, len = Math.min(e - s, maxBlockBytes);
        const bytes = await src.readRange(s, len);
        const ls = linesOf(bytes, len === e - s);
        for (let i = 0; i < ls.length; i++) {
          const srcRow = b * K + i; if (srcRow >= src.rowCount) break;
          const disp = srcRow - dataStart; if (disp < 0) continue;
          if (rows) { while (sp < rows.length && rows[sp] < disp) sp++; if (sp >= rows.length || rows[sp] !== disp) continue; sp++; }
          const l = ls[i];
          const rv = visit(disp, [String(s + l.start), lineText(bytes, l, enc)], s + l.start, l.end - l.start + (l.eol === '␍␊' ? 2 : l.eol ? 1 : 0));
          if (rv && rv.then) await rv;
          if (++seen >= limit) return;
        }
        if (onProgress) onProgress(b + 1, nBlocks);
        if (rows && sp >= rows.length) break;
      }
    },
    async readByLoc(off, len) {
      const bytes = await src.readRange(off, len);
      const ls = linesOf(bytes, true);
      return ls.length ? [String(off), lineText(bytes, ls[0], enc)] : [String(off), ''];
    },
  };
  return cur;
}

/** The 0-based line holding byte `off` (binary search on the block index, then a count within the block). */
export async function lineOfOffset(src, off) {
  const bo = src.blockOffsets;
  let lo = 0, hi = bo.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bo[mid] <= off) lo = mid; else hi = mid - 1; }
  const s = bo[lo];
  if (off <= s) return lo * src.blockSize;
  const bytes = await src.readRange(s, off - s);
  let n = 0; for (let i = 0; i < bytes.length; i++) if (bytes[i] === NL) n++;
  return Math.min(src.rowCount - 1, lo * src.blockSize + n);
}

/** The byte offset where record `rec` starts in a block source (any kind — uses its own splitting rule). */
export async function recordOffset(src, rec, splitPos) {
  const K = src.blockSize, b = Math.floor(rec / K);
  const s = src.blockOffsets[b];
  if (rec === b * K) return s;
  const e = b + 1 < src.blockOffsets.length ? src.blockOffsets[b + 1] : src.totalBytes;
  const pos = splitPos(await src.readRange(s, e - s));
  return s + (pos[rec - b * K] ? pos[rec - b * K].start : 0);
}

/** The record holding byte `off` in a block source — the inverse of recordOffset. */
export async function recordAtOffset(src, off, splitPos) {
  const bo = src.blockOffsets;
  let lo = 0, hi = bo.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bo[mid] <= off) lo = mid; else hi = mid - 1; }
  const s = bo[lo], e = lo + 1 < bo.length ? bo[lo + 1] : src.totalBytes;
  const pos = splitPos(await src.readRange(s, e - s));
  let i = 0; while (i + 1 < pos.length && s + pos[i + 1].start <= off) i++;
  return Math.min(src.rowCount - 1, lo * src.blockSize + i);
}

const HEX = '0123456789abcdef';
const hex2 = (b) => HEX[b >> 4] + HEX[b & 15];
const hexRow = (bytes, i, off) => {
  let h = '', t = '';
  for (let k = 0; k < 16; k++) {
    if (i + k < bytes.length) { const b = bytes[i + k]; h += hex2(b); t += b >= 32 && b < 127 ? String.fromCharCode(b) : '.'; }
    else h += '  ';
    h += k === 7 ? '  ' : k < 15 ? ' ' : '';
  }
  return [off.toString(16).padStart(8, '0'), h, t];
};

/**
 * A HEX view (+ cursor) over any byte reader: rows of 16 bytes, row r at offset 16·r. No index.
 * @param {object} src  { totalBytes, readRange(off, len) }
 */
export function createHexView(src, { cacheBlocks = 16, rowsPerBlock = 4096 } = {}) {
  const N = Math.ceil(src.totalBytes / 16), R = rowsPerBlock, BB = R * 16;
  const cache = new Map(), inflight = new Map(), readyCbs = [];
  const notify = () => { for (const cb of readyCbs) { try { cb(); } catch (e) { console.error('[lamina] onReady threw', e); } } };
  const nb = Math.ceil(N / R);
  async function readBlock(b) { const s = b * BB; return src.readRange(s, Math.min(BB, src.totalBytes - s)); }
  function loadBlock(b) {
    if (cache.has(b)) return Promise.resolve();
    if (inflight.has(b)) return inflight.get(b);
    const p = Promise.resolve(readBlock(b)).then((bytes) => {
      const rows = []; for (let i = 0; i < bytes.length; i += 16) rows.push(hexRow(bytes, i, b * BB + i));
      cache.set(b, rows); while (cache.size > cacheBlocks) cache.delete(cache.keys().next().value);
      inflight.delete(b); notify();
    }, (err) => { inflight.delete(b); console.error('[lamina] hex block failed', err); });
    inflight.set(b, p);
    return p;
  }
  const schema = [{ name: 'offset', type: 'string' }, { name: 'hex', type: 'string' }, { name: 'text', type: 'string' }];
  const view = {
    kind: 'raw', cols: 3, schema,
    rowCount() { return N; },
    rowAt(r) {
      if (r < 0 || r >= N) return null;
      const b = Math.floor(r / R);
      if (cache.has(b)) { const rows = cache.get(b); cache.delete(b); cache.set(b, rows); return rows[r - b * R] || null; }
      loadBlock(b);
      return LOADING;
    },
    async ensureRow(r) { if (r >= 0 && r < N) await loadBlock(Math.floor(r / R)); return this.rowAt(r); },
    header(c) { return { label: schema[c].name, type: schema[c].type }; },
    colType(c) { return schema[c].type; },
    onReady(cb) { readyCbs.push(cb); return () => { const i = readyCbs.indexOf(cb); if (i >= 0) readyCbs.splice(i, 1); }; },
  };
  const cursor = {
    kind: 'raw', rowCount: N, totalBytes: src.totalBytes, readRange: src.readRange,
    async eachRecord({ dataStart = 0, rows = null, onProgress, limit = Infinity, signal } = {}, visit) {
      let sp = 0, seen = 0;
      for (let b = 0; b < nb; b++) {
        if (signal && signal.aborted) throw new DOMException('Scan aborted', 'AbortError');
        if (rows) { if (sp >= rows.length) break; if (Math.floor(rows[sp] / R) > b) continue; }
        const bytes = await readBlock(b);
        for (let i = 0; i < bytes.length; i += 16) {
          const disp = b * R + i / 16 - dataStart; if (disp < 0) continue;
          if (rows) { while (sp < rows.length && rows[sp] < disp) sp++; if (sp >= rows.length || rows[sp] !== disp) continue; sp++; }
          const rv = visit(disp, hexRow(bytes, i, b * BB + i), b * BB + i, Math.min(16, bytes.length - i));
          if (rv && rv.then) await rv;
          if (++seen >= limit) return;
        }
        if (onProgress) onProgress(b + 1, nb);
        if (rows && sp >= rows.length) break;
      }
    },
    async readByLoc(off, len) { return hexRow(await src.readRange(off, len), 0, off); },
  };
  return { view, cursor };
}
