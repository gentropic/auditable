// @gcu/shp dbf — the dBASE III table a shapefile keeps its attributes in.
//
//   readDbf(bytes, { encoding }) → { fields: [{ name, type, length, decimals }], rows: [{ name: value }] }
//   writeDbf(rows, fields, { encoding: 'utf-8' }) → Uint8Array
//   dbfFields(rows, names?) → field descriptors sized to the values (for writeDbf)
//
// Types read: C (text), N / F (numbers — blank or '*' overflow → null), L (true / false /
// null), D (YYYYMMDD → 'YYYY-MM-DD' text), I (int32), O (double); M / anything else reads its
// raw text. Deleted records (flag '*') are skipped. Text decodes as `encoding` (a .cpg file
// says which; without one UTF-8 is tried strictly, then windows-1252, which is what an
// unlabelled DBF most often is).
//
// Writing produces dBASE III (0x03) with C and N fields only — the subset every reader
// takes. Field names are cut to 10 bytes and made unique (a dBASE limit, not ours).

const td = (enc) => { try { return new TextDecoder(enc, { fatal: false }); } catch { return new TextDecoder('windows-1252'); } };

function decodeText(bytes, encoding) {
  if (encoding) return td(encoding).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return td('windows-1252').decode(bytes); }
}

export function readDbf(input, { encoding = null } = {}) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 32) throw new Error('dbf: too short to be a dBASE table');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(4, true), headerLen = dv.getUint16(8, true), recLen = dv.getUint16(10, true);
  const fields = [];
  let off = 1;                                              // after the deletion flag
  for (let p = 32; p + 32 <= headerLen && b[p] !== 0x0d; p += 32) {
    let e = p; while (e < p + 11 && b[e] !== 0) e++;
    const name = decodeText(b.subarray(p, e), encoding).trim();
    const type = String.fromCharCode(b[p + 11]);
    const length = b[p + 16], decimals = b[p + 17];
    fields.push({ name, type, length, decimals, offset: off });
    off += length;
  }
  const rows = [];
  for (let r = 0; r < n; r++) {
    const base = headerLen + r * recLen;
    if (base + recLen > b.length) break;                    // a truncated file: what is whole
    if (b[base] === 0x2a) continue;                         // '*': deleted
    const row = {};
    for (const f of fields) {
      const s = base + f.offset, raw = b.subarray(s, s + f.length);
      let v;
      if (f.type === 'I') v = f.length === 4 ? new DataView(raw.buffer, raw.byteOffset, 4).getInt32(0, true) : null;
      else if (f.type === 'O') v = f.length === 8 ? new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, true) : null;
      else {
        const t = decodeText(raw, encoding).replace(/\0+$/, '');
        if (f.type === 'N' || f.type === 'F') {
          const tt = t.trim();
          v = tt === '' || /^\*+$/.test(tt) ? null : Number(tt);
          if (v != null && !Number.isFinite(v)) v = null;
        } else if (f.type === 'L') {
          const c = t.trim().toUpperCase();
          v = 'YT'.includes(c) && c ? true : 'NF'.includes(c) && c ? false : null;
        } else if (f.type === 'D') {
          const tt = t.trim();
          v = /^\d{8}$/.test(tt) ? `${tt.slice(0, 4)}-${tt.slice(4, 6)}-${tt.slice(6, 8)}` : tt || null;
        } else v = t.replace(/\s+$/, '');
      }
      row[f.name] = v;
    }
    rows.push(row);
  }
  return { fields: fields.map(({ name, type, length, decimals }) => ({ name, type, length, decimals })), rows };
}

const enc = new TextEncoder();
// a dBASE field name: ≤10 bytes, unique (case-insensitive), no NULs
function fieldNames(names) {
  const used = new Set(), out = [];
  for (const nm of names) {
    let base = String(nm == null ? '' : nm).replace(/[\0]/g, '').trim() || 'FIELD';
    while (enc.encode(base).length > 10) base = base.slice(0, -1);
    let cand = base, k = 1;
    while (used.has(cand.toUpperCase())) {
      const suf = String(k++);
      let stem = base;
      while (enc.encode(stem + suf).length > 10) stem = stem.slice(0, -1);
      cand = stem + suf;
    }
    used.add(cand.toUpperCase()); out.push(cand);
  }
  return out;
}

// numbers → N with enough integer and decimal width for every value; anything else → C
export function dbfFields(rows, names = null) {
  const keys = names || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const dbfName = fieldNames(keys);
  return keys.map((key, k) => {
    let numeric = true, any = false, intW = 1, dec = 0, textLen = 1;
    for (const r of rows) {
      const v = r[key];
      if (v == null || v === '') continue;
      any = true;
      if (typeof v === 'number' && Number.isFinite(v)) {
        const s = String(Math.abs(v));
        if (/e/i.test(s)) { dec = Math.max(dec, 10); intW = Math.max(intW, String(Math.trunc(Math.abs(v))).length); }
        else { const [i, d = ''] = s.split('.'); intW = Math.max(intW, i.length); dec = Math.max(dec, d.length); }
      } else if (typeof v === 'boolean') { numeric = false; textLen = Math.max(textLen, 5); }
      else { numeric = false; textLen = Math.max(textLen, enc.encode(String(v)).length); }
    }
    if (numeric && any) {
      dec = Math.min(dec, 15);
      const length = Math.min(254, 1 + intW + (dec ? dec + 1 : 0));   // sign + digits + point + decimals
      return { key, name: dbfName[k], type: 'N', length, decimals: dec };
    }
    return { key, name: dbfName[k], type: 'C', length: Math.min(254, textLen), decimals: 0 };
  });
}

// cut a UTF-8 byte array to `n` bytes without splitting a character
function clipUtf8(bytes, n) {
  if (bytes.length <= n) return bytes;
  let e = n;
  while (e > 0 && (bytes[e] & 0xc0) === 0x80) e--;
  return bytes.subarray(0, e);
}

export function writeDbf(rows, fields) {
  const headerLen = 32 + 32 * fields.length + 1;
  const recLen = 1 + fields.reduce((s, f) => s + f.length, 0);
  const out = new Uint8Array(headerLen + recLen * rows.length + 1);
  const dv = new DataView(out.buffer);
  const now = new Date();
  out[0] = 0x03;
  out[1] = now.getUTCFullYear() - 1900; out[2] = now.getUTCMonth() + 1; out[3] = now.getUTCDate();
  dv.setUint32(4, rows.length, true);
  dv.setUint16(8, headerLen, true);
  dv.setUint16(10, recLen, true);
  out[29] = 0x00;                                           // no LDID: the .cpg says UTF-8
  fields.forEach((f, i) => {
    const p = 32 + i * 32;
    out.set(clipUtf8(enc.encode(f.name), 10), p);
    out[p + 11] = f.type.charCodeAt(0);
    out[p + 16] = f.length; out[p + 17] = f.decimals || 0;
  });
  out[headerLen - 1] = 0x0d;
  for (let r = 0; r < rows.length; r++) {
    let p = headerLen + r * recLen;
    out[p++] = 0x20;                                        // not deleted
    for (const f of fields) {
      const v = rows[r][f.key != null ? f.key : f.name];
      out.fill(0x20, p, p + f.length);
      if (v != null && v !== '') {
        if (f.type === 'N') {
          const n = typeof v === 'number' ? v : Number(v);
          if (Number.isFinite(n)) {
            let s = f.decimals ? n.toFixed(f.decimals) : String(Math.round(n));
            if (s.length > f.length) s = '*'.repeat(f.length);   // dBASE's overflow mark
            out.set(enc.encode(s.padStart(f.length, ' ')), p);
          }
        } else out.set(clipUtf8(enc.encode(String(v)), f.length), p);
      }
      p += f.length;
    }
  }
  out[out.length - 1] = 0x1a;                               // end of file
  return out;
}
