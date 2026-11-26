// A render with a transparent background (and the shadow-catcher's shadow) composited onto the cover's
// basalt — to judge a render as it will sit on the page.   node on-basalt.mjs in.png out.png
import { readFile } from 'fs/promises';
import { chromium } from 'playwright';
// The cover uses this too: the shadow catcher leaves a few percent of alpha over the whole frame, and on the
// page that frame's edge showed as a faint rectangle. Composited onto the page's own basalt (#161616 =
// wuffle.sty's basalt), the render has no edge left to see. An out path ending .jpg writes a JPEG.
const [, , inp, out] = process.argv;
const jpeg = /\.jpe?g$/i.test(out);
const b64 = (await readFile(inp)).toString('base64');
const browser = await chromium.launch();
try {
  const p = await browser.newPage();
  const png = await p.evaluate(async ([data, jpeg]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.fillStyle = '#161616'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
    return c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.92).split(',')[1];
  }, [b64, jpeg]);
  await (await import('fs/promises')).writeFile(out, Buffer.from(png, 'base64'));
} finally { await browser.close(); }
