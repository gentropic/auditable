// A flat sketch of Site C (src/site-c.js) — the geological map and two sections — to judge the geology before any render.
//   node sketch.mjs [out.png]
import { writeFile } from 'fs/promises';
import { chromium } from 'playwright';
import { BOX, UNITS, lith, grade, topo, drillholes, FRAME } from '../../../src/site-c.js';

const out = process.argv[2] || 'deposit-sketch.png';
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const COL = UNITS.map((u) => (u.color ? hex(u.color) : [22, 22, 22]));
const ORE = [255, 176, 64];

// shade a pixel: the unit's colour; where the grade is ≥ 1 g/t, blend toward amber, stronger with grade
function shade(u, g) {
  const c = COL[u].slice();
  if (g >= 1) { const t = Math.min(1, 0.35 + (g - 1) / 4); for (let i = 0; i < 3; i++) c[i] = Math.round(c[i] * (1 - t) + ORE[i] * t); }
  return c;
}
function panel(w, h, at) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = at(i, j); const k = (j * w + i) * 4;
    if (!p) { px.set([22, 22, 22, 255], k); continue; }
    const u = lith(...p); const c = u ? shade(u, grade(...p)) : [22, 22, 22];
    px.set([c[0], c[1], c[2], 255], k);
  }
  return { w, h, data: Buffer.from(px.buffer).toString('base64') };
}

const S = 2;   // metres per pixel
// the map: surface geology, sampled just under the topography
const map = panel(Math.round((BOX.x1 - BOX.x0) / S), Math.round((BOX.y1 - BOX.y0) / S), (i, j) => {
  const x = BOX.x0 + i * S, y = BOX.y1 - j * S; return [x, y, topo(x, y) - 16];
});
// sections: through the axis point, A across the axis (looking NE, 310°→130°), B along it (looking NW, 220°→040°)
const D = Math.PI / 180, C = FRAME.centre;
const secDefs = [
  { name: 'A — across the fold (looking 040°)', az: 130, half: 650 },
  { name: 'B — along the plunge (looking 310°)', az: 40, half: 650 },
];
const ZTOP = 380, ZBOT = -200;
const sections = secDefs.map((s) => {
  const ux = Math.sin(s.az * D), uy = Math.cos(s.az * D);
  const w = (2 * s.half) / S, h = (ZTOP - ZBOT) / S;
  const p = panel(w, h, (i, j) => [C.x + ux * (i * S - s.half), C.y + uy * (i * S - s.half), ZTOP - j * S]);
  // drillhole traces within 60 m of the section plane, projected onto it
  const nx = Math.cos(s.az * D), ny = -Math.sin(s.az * D);
  p.holes = drillholes().map((hole) => {
    const pts = [];
    for (let d = 0; d <= hole.length; d += 5) {
      const [x, y, z] = hole.at(d);
      const off = (x - C.x) * nx + (y - C.y) * ny;
      if (Math.abs(off) < 60) pts.push([((x - C.x) * ux + (y - C.y) * uy + s.half) / S, (ZTOP - z) / S]);
    }
    return pts;
  }).filter((t) => t.length > 1);
  p.name = s.name; p.ux = ux; p.uy = uy; p.half = s.half;
  return p;
});
const collars = drillholes().map((h) => [(h.x - BOX.x0) / S, (BOX.y1 - h.y) / S]);
const secLines = sections.map((s) => [
  [(C.x - s.ux * s.half - BOX.x0) / S, (BOX.y1 - (C.y - s.uy * s.half)) / S],
  [(C.x + s.ux * s.half - BOX.x0) / S, (BOX.y1 - (C.y + s.uy * s.half)) / S]]);
const legend = UNITS.filter((u) => u.color).map((u) => [u.name, u.color]);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const png = await page.evaluate(async ({ map, sections, collars, secLines, legend }) => {
    const W = 2000, H = 1500, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#161616'; g.fillRect(0, 0, W, H);
    const put = (p, x, y) => { const id = new ImageData(new Uint8ClampedArray(Uint8Array.from(atob(p.data), (ch) => ch.charCodeAt(0)).buffer), p.w, p.h); g.putImageData(id, x, y); };
    g.font = '20px sans-serif'; g.fillStyle = '#ddd';
    // map
    const MX = 40, MY = 60; put(map, MX, MY); g.fillText('Geological map (surface), 2 m/px — north up', MX, MY - 16);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.setLineDash([10, 6]);
    secLines.forEach(([a, b], k) => { g.beginPath(); g.moveTo(MX + a[0], MY + a[1]); g.lineTo(MX + b[0], MY + b[1]); g.stroke();
      g.fillText('AB'[k], MX + b[0] + 6, MY + b[1]); });
    g.setLineDash([]); g.fillStyle = '#fff';
    collars.forEach(([x, y]) => { g.beginPath(); g.arc(MX + x, MY + y, 4, 0, 7); g.fill(); });
    // legend
    let ly = MY; legend.forEach(([n, col]) => { g.fillStyle = col; g.fillRect(MX + map.w + 30, ly, 26, 18); g.fillStyle = '#ddd'; g.fillText(n, MX + map.w + 66, ly + 16); ly += 30; });
    g.fillStyle = '#ffb040'; g.fillRect(MX + map.w + 30, ly + 10, 26, 18); g.fillStyle = '#ddd'; g.fillText('grade ≥ 1 g/t (amber, stronger with grade)', MX + map.w + 66, ly + 26);
    // sections
    let sy = MY + map.h + 70;
    sections.forEach((s, k) => {
      const sx = k === 0 ? 40 : 40 + s.w + 40;
      if (k === 1) sy = MY + map.h + 70;
      g.fillStyle = '#ddd'; g.fillText('Section ' + s.name, sx, sy - 16);
      put(s, sx, sy);
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      s.holes.forEach((t) => { g.beginPath(); t.forEach(([x, y], i) => (i ? g.lineTo(sx + x, sy + y) : g.moveTo(sx + x, sy + y))); g.stroke(); });
    });
    return c.toDataURL('image/png').split(',')[1];
  }, { map, sections, collars, secLines, legend });
  await writeFile(out, Buffer.from(png, 'base64'));
} finally { await browser.close(); }
console.log('wrote', out);
