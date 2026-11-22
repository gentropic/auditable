// The document: pages, the resources they share (fonts, transparency states, images — each
// written once however many pages use it), and the file. `save()` is async because content and
// images are deflated with the platform's CompressionStream (no bundled zlib, no WASM).

import { PdfContext2D, num } from './context.js';
import { pageSize } from './sizes.js';
import { STANDARD_FONTS } from './fonts.js';

const enc = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// a PDF text string: ASCII as a literal, anything else as UTF-16BE hex with a BOM
function textString(s) {
  s = String(s);
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return '<' + hex + '>';
}
const pdfDate = (d) => {
  const p = (n, k = 2) => String(n).padStart(k, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};
// a short content hash for the trailer /ID (FNV-1a, two lanes)
function idHash(chunks) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (const c of chunks) for (let i = 0; i < c.length; i++) { a = Math.imul(a ^ c[i], 16777619) >>> 0; b = Math.imul(b ^ c[i], 2246822519) >>> 0; }
  return [a, b, a ^ b, (a + b) >>> 0].map((v) => v.toString(16).padStart(8, '0')).join('');
}

export class PdfPage {
  constructor(doc, width, height, units) {
    this._doc = doc;
    this.width = width; this.height = height;              // points
    this._ops = [];
    this._fonts = new Map(); this._gss = new Map(); this._images = new Map();
    this._units = units;
  }
  // a 2D context over this page; units 'pt' (default) or 'mm' for the user space
  getContext(kind = '2d', { units } = {}) {
    if (kind !== '2d') throw new Error(`@gcu/pdf: only a '2d' context (got '${kind}')`);
    const u = units || this._units || 'pt', k = u === 'mm' ? 72 / 25.4 : 1;
    // user space (y down, from the top-left) → PDF page space (y up, from the bottom-left)
    return new PdfContext2D(this, [k, 0, 0, -k, 0, this.height]);
  }
  _font(name) {
    if (!this._fonts.has(name)) this._fonts.set(name, 'F' + (STANDARD_FONTS.indexOf(name) + 1));
    return this._fonts.get(name);
  }
  _gs(ca, CA) {
    const key = `${num(ca)}/${num(CA)}`;
    if (!this._gss.has(key)) this._gss.set(key, { name: 'GS' + (this._doc._gsKeys.indexOf(key) >= 0 ? this._doc._gsKeys.indexOf(key) : this._doc._gsKeys.push(key) - 1), ca, CA });
    return this._gss.get(key).name;
  }
  _image(src, sx, sy, sw, sh, smooth, warn) {
    const img = this._doc._imageOf(src, sx, sy, sw, sh, smooth, warn);
    if (!img) return null;
    this._images.set(img.name, img);
    return img.name;
  }
}

export class PdfDocument {
  // { title, author, subject, keywords, creator, created (Date or ISO string — for reproducible output),
  //   compress (default true), onWarn(msg), strict (warnings throw) }
  constructor(opts = {}) {
    this.opts = { compress: true, ...opts };
    this.pages = [];
    this.warnings = [];
    this._warned = new Set();
    this._gsKeys = [];
    this._imgs = [];                                       // { name, w, h, rgb, alpha, jpeg, smooth }
    this._imgCache = new WeakMap();
  }
  // addPage() → A4 portrait · addPage('A3', 'landscape') · addPage([w, h]) in mm · addPage({ width, height }) in points
  addPage(size = 'A4', orientation = null, { units = 'pt' } = {}) {
    let w, h;
    if (size && typeof size === 'object' && !Array.isArray(size)) { w = +size.width; h = +size.height; }
    else [w, h] = pageSize(size, orientation, 'mm');
    if (!(w > 0 && h > 0)) throw new Error('@gcu/pdf: a page needs a positive width and height');
    const p = new PdfPage(this, w, h, units);
    this.pages.push(p);
    return p;
  }

  _warn(key, msg) {
    if (this.opts.strict) throw new Error('@gcu/pdf: ' + msg);
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this.warnings.push(msg);
    if (this.opts.onWarn) this.opts.onWarn(msg);
  }

  // pixels (or JPEG bytes) for an image source, cropped; cached per source + crop
  _imageOf(src, sx, sy, sw, sh, smooth, warn) {
    const key = `${sx},${sy},${sw},${sh},${smooth ? 1 : 0}`;
    const byKey = typeof src === 'object' && src ? (this._imgCache.get(src) || this._imgCache.set(src, new Map()).get(src)) : null;
    if (byKey && byKey.has(key)) return byKey.get(key);
    let rec = null;
    if (src.jpeg) {
      if (sx || sy || sw !== src.width || sh !== src.height) warn('jpegcrop', 'a cropped JPEG source is drawn whole (crop needs decoded pixels)');
      rec = { jpeg: src.jpeg instanceof Uint8Array ? src.jpeg : new Uint8Array(src.jpeg), w: src.width, h: src.height, smooth };
    } else {
      const px = pixelsOf(src);
      if (!px) { warn('imgsrc', 'drawImage: a source this context can\'t read pixels from (give ImageData, a canvas, an ImageBitmap or {jpeg, width, height})'); return null; }
      const x0 = Math.max(0, Math.round(sx)), y0 = Math.max(0, Math.round(sy));
      const w = Math.max(1, Math.min(px.width - x0, Math.round(sw))), h = Math.max(1, Math.min(px.height - y0, Math.round(sh)));
      const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
      let anyAlpha = false;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = ((y0 + r) * px.width + x0 + c) * 4, o = r * w + c;
        rgb[o * 3] = px.data[i]; rgb[o * 3 + 1] = px.data[i + 1]; rgb[o * 3 + 2] = px.data[i + 2];
        const a = px.data[i + 3]; alpha[o] = a; if (a !== 255) anyAlpha = true;
      }
      rec = { rgb, alpha: anyAlpha ? alpha : null, w, h, smooth };
    }
    rec.name = 'Im' + (this._imgs.push(rec) - 1);
    if (byKey) byKey.set(key, rec);
    return rec;
  }

  // → Uint8Array of the PDF file
  async save() {
    const objs = [];                                       // [id] = { dict, stream? } (1-based)
    const add = (o) => { objs.push(o); return objs.length; };
    const catalogId = add(null), pagesId = add(null);
    const compress = this.opts.compress !== false;
    const stream = async (dict, bytes) => {
      if (compress) { const z = await deflate(bytes); if (z) return { dict: `${dict} /Filter /FlateDecode /Length ${z.length}`, bytes: z }; }
      return { dict: `${dict} /Length ${bytes.length}`, bytes };
    };
    // shared resources: fonts used anywhere, gs states, images
    const fontsUsed = new Set(); for (const p of this.pages) for (const n of p._fonts.keys()) fontsUsed.add(n);
    const fontIds = {};
    for (const n of fontsUsed) fontIds[n] = add({ dict: `<< /Type /Font /Subtype /Type1 /BaseFont /${n} /Encoding /WinAnsiEncoding >>` });
    const gsIds = {};
    this._gsKeys.forEach((k, i) => { const [ca, CA] = k.split('/'); gsIds['GS' + i] = add({ dict: `<< /Type /ExtGState /ca ${ca} /CA ${CA} >>` }); });
    const imgIds = {};
    for (const im of this._imgs) {
      if (im.jpeg) {
        imgIds[im.name] = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Interpolate ${im.smooth} /Length ${im.jpeg.length} >>`, bytes: im.jpeg });
        continue;
      }
      let smask = '';
      if (im.alpha) {
        const s = await stream(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate ${im.smooth}`, im.alpha);
        const sid = add({ dict: s.dict + ' >>', bytes: s.bytes });
        smask = ` /SMask ${sid} 0 R`;
      }
      const s = await stream(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate ${im.smooth}${smask}`, im.rgb);
      imgIds[im.name] = add({ dict: s.dict + ' >>', bytes: s.bytes });
    }
    // pages
    const pageIds = [];
    for (const p of this.pages) {
      const content = await stream('<<', enc(p._ops.join('\n')));
      const cid = add({ dict: content.dict + ' >>', bytes: content.bytes });
      const res = [];
      if (p._fonts.size) res.push(`/Font << ${[...p._fonts].map(([n, tag]) => `/${tag} ${fontIds[n]} 0 R`).join(' ')} >>`);
      if (p._gss.size) res.push(`/ExtGState << ${[...p._gss.values()].map((g) => `/${g.name} ${gsIds[g.name]} 0 R`).join(' ')} >>`);
      if (p._images.size) res.push(`/XObject << ${[...p._images.keys()].map((n) => `/${n} ${imgIds[n]} 0 R`).join(' ')} >>`);
      pageIds.push(add({ dict: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << ${res.join(' ')} >> /Contents ${cid} 0 R >>` }));
    }
    objs[pagesId - 1] = { dict: `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>` };
    objs[catalogId - 1] = { dict: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` };
    const o = this.opts, info = [];
    for (const [k, v] of [['Title', o.title], ['Author', o.author], ['Subject', o.subject], ['Keywords', o.keywords], ['Creator', o.creator]]) if (v) info.push(`/${k} ${textString(v)}`);
    info.push(`/Producer ${textString('@gcu/pdf')}`);
    info.push(`/CreationDate (${pdfDate(o.created instanceof Date ? o.created : o.created ? new Date(o.created) : new Date())})`);
    const infoId = add({ dict: `<< ${info.join(' ')} >>` });

    // the file: header, objects, xref, trailer
    const chunks = [enc('%PDF-1.7\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
    let at = chunks[0].length + chunks[1].length;
    const offsets = [];
    objs.forEach((ob, i) => {
      offsets[i] = at;
      const head = enc(`${i + 1} 0 obj\n${ob.dict}\n`);
      chunks.push(head); at += head.length;
      if (ob.bytes) {
        const s0 = enc('stream\n'), s1 = enc('\nendstream\n');
        chunks.push(s0, ob.bytes, s1); at += s0.length + ob.bytes.length + s1.length;
      }
      const tail = enc('endobj\n'); chunks.push(tail); at += tail.length;
    });
    const id = idHash(chunks);
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${at}\n%%EOF\n`;
    chunks.push(enc(xref));
    const total = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(total);
    let k = 0; for (const c of chunks) { out.set(c, k); k += c.length; }
    return out;
  }
}

// RGBA pixels of an image source: ImageData-like, a canvas (any kind), an ImageBitmap/image
function pixelsOf(src) {
  if (src && src.data && src.width && src.height && src.data.length >= src.width * src.height * 4) return src;
  if (src && typeof src.getContext === 'function') {
    try { const g = src.getContext('2d'); if (g && g.getImageData) return g.getImageData(0, 0, src.width, src.height); } catch { /* a WebGL canvas: below */ }
  }
  const w = src && (src.naturalWidth || src.videoWidth || src.width), h = src && (src.naturalHeight || src.videoHeight || src.height);
  if (!w || !h) return null;
  try {
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = cv.getContext('2d'); g.drawImage(src, 0, 0); return g.getImageData(0, 0, w, h);
  } catch { return null; }
}
