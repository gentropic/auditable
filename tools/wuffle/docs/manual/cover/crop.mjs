// Crop a region of an image at full scale (to inspect edges a downscaled view hides).
//   node crop.mjs in.png out.png x y w h
import { readFile, writeFile } from 'fs/promises';
import { chromium } from 'playwright';
const [, , inp, out, x, y, w, h] = process.argv;
const b64 = (await readFile(inp)).toString('base64');
const browser = await chromium.launch();
try {
  const p = await browser.newPage();
  const png = await p.evaluate(async ([data, x, y, w, h]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#161616'; g.fillRect(0, 0, w, h); g.imageSmoothingEnabled = false;
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, [b64, +x, +y, +w, +h]);
  await writeFile(out, Buffer.from(png, 'base64'));
} finally { await browser.close(); }
