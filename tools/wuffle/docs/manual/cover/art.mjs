// The cover's figure, drawn by wuffle's own maths from wuffle's own sample: the Tocher (1979) planes on a
// lower-hemisphere equal-area net — a Fisher-kernel density field, Kamb contours at 2σ intervals over it,
// every great circle faintly, every pole. The cover says so in its caption: the art is a figure.
//
//   node tools/wuffle/docs/manual/cover/art.mjs   → cover/art.svg and cover/art.png (transparent, 2800 px)
import { readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import * as B from '../../../../../ext/bearing/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const csv = await readFile(join(ROOT, 'tools/wuffle/samples/tocher.csv'), 'utf8');
const planes = csv.split('\n').filter((l) => /^\d/.test(l)).map((l) => l.split(',').map(Number));
const poles = planes.map(([dd, dip]) => B.conversions.planeToDcos(dd, dip));

// the palette: basalt ground → deep teal → amber → bone (the GCU's dark theme, warmed)
const stops = [[0, [22, 32, 36]], [0.25, [31, 74, 82]], [0.5, [120, 102, 52]], [0.72, [200, 155, 60]], [0.9, [232, 196, 128]], [1, [244, 232, 205]]];
const ramp = (t) => {
  t = Math.max(0, Math.min(1, t));
  let i = 0; while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, a] = stops[i], [t1, b] = stops[i + 1], k = (t - t0) / (t1 - t0 || 1);
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(',')})`;
};

const SIZE = 1400;
const net = new B.Stereonet({
  size: SIZE, padding: 4, projection: 'equal-area', gridSpacing: 10, classPrefix: 'c',
  style: {
    background: 'none',
    primitive: { stroke: 'rgb(200,155,60)', strokeWidth: 3, fill: 'none' },
    grid: { stroke: 'rgba(244,232,205,0.07)', strokeWidth: 0.8, majorStroke: 'rgba(244,232,205,0.12)', majorStrokeWidth: 1 },
    cardinals: { fill: 'none', fontSize: 0, offset: 0 },
  },
});
net.heatmap(poles, { gridSize: 360, color: ramp, threshold: 0, opacity: 1 });
for (const [dd, dip] of planes) net.plane(dd, dip, { stroke: 'rgba(244,232,205,0.16)', strokeWidth: 1.1, fill: 'none' });
net.contour(poles, { method: 'kamb', kambSigma: 3, gridSize: 160, levels: [2, 4, 6, 8, 10, 12], stroke: 'rgba(244,232,205,0.55)', strokeWidth: 1.6 });
for (const [dd, dip] of planes) net.pole(dd, dip, { fill: 'rgb(244,232,205)', r: 3.2, stroke: 'rgba(22,22,22,0.6)', strokeWidth: 1 });
const svg = net.svg().replace(/<text[^>]*>[^<]*<\/text>/g, '');   // no cardinal letters on a cover
await writeFile(join(HERE, 'art.svg'), svg);

// → a transparent PNG at 2× (LuaLaTeX includes PNG, not SVG)
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 2 });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await p.locator('svg').first().screenshot({ path: join(HERE, 'art.png'), omitBackground: true });
} finally { await browser.close(); }
console.log(`cover art: ${planes.length} planes → cover/art.png`);
