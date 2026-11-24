// INSERT — what an editor adds in more than one frame or from outside the page: the title block,
// an image from a file, small multiples. Each takes the editor (mountEditor's handle), adds its
// frames, selects them and returns their ids. The host keeps what is its own: what goes IN a
// frame (a render, a scene), and where things are kept.
import { groupFrames, removeFrames } from './model.js';
import { titleBlockFrames } from './house.js';

// the title block (house.js) as one group, bottom-right
export function addTitleBlock(ed, opts = {}) {
  const ids = titleBlockFrames(ed.getDoc(), opts).map((fr) => ed.addFrame(fr).id);
  ed.update(ids[0], () => groupFrames(ed.getDoc(), ids));
  ed.select(ids); ed.render();
  return ids;
}

// ── an image: a logo, a photo, a sketch ──
// addImageSrc(ed, src) — src a URL the page can load (a data: URL from a file, a blob: URL); the
// frame lands top-left inside the margins, `width` mm wide at the image's own aspect. `source` is the
// host's record of it (compo keeps it, never reads it).
export async function addImageSrc(ed, src, { name = 'image', width = 35, source = null } = {}) {
  const im = new Image(); im.src = src; await im.decode();
  const doc = ed.getDoc(), m = doc.page.margins || [10, 10, 10, 10], h = +(width * im.height / Math.max(1, im.width)).toFixed(1);
  const f = ed.addFrame({ kind: 'image', box: [m[3] + 4, m[0] + 4, width, h], content: { src, width: im.width, height: im.height, fit: 'contain' }, ...(source ? { source } : {}) });
  f._img = typeof createImageBitmap !== 'undefined' ? await createImageBitmap(im) : im; ed.render();
  return f;
}
// a File / Blob → a data: URL (what a saved document can carry)
export const readImageFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
// the browser's file picker → addImageSrc. opts.source(name) → the frame's source record
export function addImageFromFile(ed, opts = {}) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    await addImageSrc(ed, await readImageFile(file), { ...opts, name: file.name, source: opts.source ? opts.source(file.name) : null });
  };
  inp.click();
}

// ── SMALL MULTIPLES: one frame repeated n times in a grid over its own box, each copy captioned ──
// multiplesGrid(box, n, { cols }) — the cells: [{ box, caption }] in reading order, `cols` per row
// (else about square), a caption strip under each. Throws when the cells would be too small.
export function multiplesGrid(box, n, { cols = 0, gap = 3, capH = 5 } = {}) {
  const C = Math.max(1, Math.min(n, +cols || Math.ceil(Math.sqrt(n)))), R = Math.ceil(n / C);
  const cw = (box[2] - gap * (C - 1)) / C, ch = (box[3] - R * capH - gap * (R - 1)) / R;
  if (!(cw > 8 && ch > 8)) throw new Error('the view frame is too small for that many — make it bigger first');
  const cells = [];
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / C), c = k % C, x = box[0] + c * (cw + gap), y = box[1] + r * (ch + capH + gap);
    cells.push({ box: [+x.toFixed(2), +y.toFixed(2), +cw.toFixed(2), +ch.toFixed(2)], caption: [+x.toFixed(2), +(y + ch + 0.5).toFixed(2), +cw.toFixed(2), capH - 0.5] });
  }
  return { cols: C, rows: R, cells };
}
// smallMultiples(ed, f, { n, variant, caption }) — the host makes copy k: `await variant(k, box)` adds
// a frame in that box and returns it; `caption(k)` is its caption's text (a field such as {section}
// works: the caption refers to its copy). Then f goes, and the copies + captions become one group.
// → the new ids. A variant that throws stops it there, f still in place.
export async function smallMultiples(ed, f, { n, variant, caption = (k) => String(k + 1), cols = 0, gap = 3, capH = 5, size = 7 }) {
  const { cells } = multiplesGrid(f.box, n, { cols, gap, capH });
  const made = [];
  for (let k = 0; k < n; k++) {
    const vf = await variant(k, cells[k].box);
    const cap = ed.addFrame({ kind: 'text', box: cells[k].caption, content: { md: caption(k), size, align: 'center', of: vf.id } });
    made.push(vf.id, cap.id);
  }
  const d = ed.getDoc();
  removeFrames(d, [f.id]); groupFrames(d, made);
  ed.select(made); ed.render();
  return made;
}
