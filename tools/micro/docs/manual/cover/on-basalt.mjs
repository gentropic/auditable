// A render with a transparent background (and the shadow-catcher's shadow) composited onto the cover's
// basalt — to judge a render as it will sit on the page.   node on-basalt.mjs in.png out.png [feather]
// (from wuffle's manual; each manual's cover is self-contained)
import { readFile } from 'fs/promises';
import { chromium } from 'playwright';
// The cover uses this too: the shadow catcher leaves a few percent of alpha over the whole frame, and on the
// page that frame's edge showed as a faint rectangle. Composited onto the page's own basalt (#161616 =
// micro.sty's basalt), the render has no edge left to see — except where the soft shadow round the subject
// reaches the frame: micro's cover shows the render's LEFT edge on the page, so the render's alpha fades in
// over the left `feather` of its width (default 0.12; 0 = off). An out path ending .jpg writes a JPEG.
const [, , inp, out, featherArg] = process.argv;
const feather = featherArg === undefined ? 0.12 : +featherArg;
const jpeg = /\.jpe?g$/i.test(out);
const b64 = (await readFile(inp)).toString('base64');
const browser = await chromium.launch();
try {
  const p = await browser.newPage();
  const png = await p.evaluate(async ([data, jpeg, feather]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tg = t.getContext('2d'); tg.drawImage(img, 0, 0);
    if (feather > 0) {
      const ramp = tg.createLinearGradient(0, 0, W * feather, 0);
      ramp.addColorStop(0, 'rgba(0,0,0,0)'); ramp.addColorStop(1, 'rgba(0,0,0,1)');
      // the whole width: destination-in clears whatever the fill doesn't cover (the ramp pads at 1 past its end)
      tg.globalCompositeOperation = 'destination-in'; tg.fillStyle = ramp; tg.fillRect(0, 0, W, H);
    }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#161616'; g.fillRect(0, 0, W, H); g.drawImage(t, 0, 0);
    return c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.92).split(',')[1];
  }, [b64, jpeg, feather]);
  await (await import('fs/promises')).writeFile(out, Buffer.from(png, 'base64'));
} finally { await browser.close(); }
