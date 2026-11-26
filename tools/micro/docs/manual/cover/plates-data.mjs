// micro's cover, the drawings: from micro's Site C model (src/site-c.js), (1) the geological map as a printed A3 sheet at 1 : 5 000 and
// (2) three serial-section glass plates at 1 : 10 000, painted — then plates.py lays them on a desk in Blender.
//
//   node plates-data.mjs            → textures/map.png, textures/plate-{A,B,C}.png, plates.json
//
// Everything on the sheet is drawn from the model: the units and their contacts, the ore envelope, the bedding
// symbols (the gradient of the stratigraphic field), the fault and the fold traces (solved on the topography),
// the 5 m contours, the drillholes, the section lines. The deposit, its name and its coordinates are imaginary.
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { BOX, ORIGIN, UNITS, lith, grade, topo, drillholes, FRAME, faultSide, hingeAt, bedding } from '../../../src/site-c.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = 'Site C';   // the imaginary prospect: the sheet's title and the plates' captions
const TEX = join(HERE, 'textures');
const FONTS = join(HERE, '..', 'fonts');
const D = Math.PI / 180;
const t0 = Date.now(); const lap = (s) => console.log(`  ${s} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// ── the sheet: A3 landscape, 16 px/mm; the map frame 280 × 235 mm at 1 : 5 000 (0.3125 m/px) ─────────────────
const PX = 16, SCALE = 5000;
const MAP = { x: 16, y: 22, w: (BOX.x1 - BOX.x0) / SCALE * 1000, h: (BOX.y1 - BOX.y0) / SCALE * 1000 };   // mm
const MW = Math.round(MAP.w * PX), MH = Math.round(MAP.h * PX), MPP = (BOX.x1 - BOX.x0) / MW;          // m per px
const E0 = ORIGIN.E, N0 = ORIGIN.N;                                                                       // imaginary UTM
const toMap = (x, y) => [(x - BOX.x0) / MPP, (BOX.y1 - y) / MPP];                                       // → map px
const inBox = (x, y) => x >= BOX.x0 && x <= BOX.x1 && y >= BOX.y0 && y <= BOX.y1;
const DEPTH = 12;   // the map shows the bedrock just under the regolith

// the units raster (code | 0x80 where grade ≥ 1 g/t) and the topography, per map pixel
const units = new Uint8Array(MW * MH), contour = new Uint8Array(MW * MH);
{
  const tz = new Float32Array(MW * MH);
  for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
    const x = BOX.x0 + (i + 0.5) * MPP, y = BOX.y1 - (j + 0.5) * MPP, t = topo(x, y), z = t - DEPTH;
    const u = lith(x, y, z);
    units[j * MW + i] = u | ((u === 4 || u === 9) && grade(x, y, z) >= 1 ? 0x80 : 0);
    tz[j * MW + i] = t;
  }
  // contours every 5 m, index every 25 m: a pixel where the 5 m band changes toward its right or lower neighbour
  for (let j = 0; j < MH - 1; j++) for (let i = 0; i < MW - 1; i++) {
    const k = j * MW + i, a = Math.floor(tz[k] / 5);
    for (const n of [k + 1, k + MW]) {
      const b = Math.floor(tz[n] / 5);
      if (a !== b) { const lvl = Math.max(a, b) * 5; contour[k] = Math.max(contour[k], lvl % 25 === 0 ? 2 : 1); }
    }
  }
  // spot heights on the index contours: a few labels, where an index contour crosses chosen columns
  lap('map raster');
  var contourLabels = [];
  for (const fx of [0.14, 0.4, 0.66, 0.9]) {
    const i = Math.round(fx * MW); let last = -1e9;
    for (let j = 40; j < MH - 40; j++) if (contour[j * MW + i] === 2 && j - last > 260) {
      const lvl = Math.round(tz[j * MW + i] / 25) * 25; contourLabels.push([i, j, lvl]); last = j;
    }
  }
}

// unit labels: points well inside each unit (a coarse 10 m grid, interior = every cell within 40 m agrees)
const CODES = { 2: 'Agn', 3: 'PPq', 4: 'PPf', 5: 'PPm', 6: 'PPp', 7: 'PPv', 8: 'NPγ', 9: 'sk' };
const labels = [];
{
  const G = 10, gw = Math.floor((BOX.x1 - BOX.x0) / G), gh = Math.floor((BOX.y1 - BOX.y0) / G), g = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const x = BOX.x0 + (i + 0.5) * G, y = BOX.y1 - (j + 0.5) * G; g[j * gw + i] = lith(x, y, topo(x, y) - DEPTH); }
  const R = 4, best = {};
  for (let j = 4; j < gh - 4; j++) for (let i = 4; i < gw - 4; i++) {
    const u = g[j * gw + i]; if (!CODES[u]) continue;
    let r = 0;
    grow: for (r = 1; r <= 14; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const jj = j + dj, ii = i + di; if (jj < 0 || ii < 0 || jj >= gh || ii >= gw || g[jj * gw + ii] !== u) break grow;
    }
    if (r - 1 >= (u === 4 || u === 9 ? 2 : R)) (best[u] ||= []).push([r - 1, i, j]);
  }
  for (const [u, cands] of Object.entries(best)) {
    cands.sort((a, b) => b[0] - a[0]); const got = [];
    for (const [, i, j] of cands) {
      if (got.length >= (u == 6 || u == 7 ? 3 : 2)) break;
      if (got.every(([a, b]) => Math.hypot(a - i, b - j) > 32)) got.push([i, j]);
    }
    for (const [i, j] of got) labels.push([...toMap(BOX.x0 + (i + 0.5) * G, BOX.y1 - (j + 0.5) * G), CODES[u]]);
  }
}

// strike and dip: a jittered 100 m grid over the layered units (not too close to the fault)
const dips = [];
{
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const keepOut = [...labels.map((l) => [l[0], l[1], 110]), ...drillholes().map((h) => [...toMap(h.x, h.y), 90])];
  for (let y = BOX.y0 + 60; y < BOX.y1 - 40; y += 125) for (let x = BOX.x0 + 60; x < BOX.x1 - 40; x += 125) {
    const px = x + (rnd() - 0.5) * 60, py = y + (rnd() - 0.5) * 60, z = topo(px, py) - DEPTH, u = lith(px, py, z);
    if (u < 3 || u > 7 || Math.abs(faultSide(px, py, z)) < 25) continue;
    const m = toMap(px, py); if (keepOut.some(([a, b, r]) => Math.hypot(a - m[0], b - m[1]) < r)) continue;
    const b = bedding(px, py, z); dips.push([...m, b.dipdir, Math.round(b.dip)]);
  }
}

// a trace solved on the topography: for each step along `along`, bisect `f` across it
function solveTrace(origin, along, across, tRange, sRange, f) {
  const pts = [];
  for (let t = tRange[0]; t <= tRange[1]; t += 5) {
    const at = (s) => [origin[0] + along[0] * t + across[0] * s, origin[1] + along[1] * t + across[1] * s];
    let a = sRange[0], b = sRange[1], fa = f(...at(a)), fb = f(...at(b));
    if (fa * fb > 0) continue;
    for (let k = 0; k < 40; k++) { const m = (a + b) / 2, fm = f(...at(m)); if (fa * fm <= 0) { b = m; fb = fm; } else { a = m; fa = fm; } }
    const p = at((a + b) / 2); if (inBox(...p)) pts.push(toMap(...p));
  }
  return pts;
}
const F = FRAME.fault, FS = [Math.sin(F.strike), Math.cos(F.strike)], FD = [Math.sin(F.strike + Math.PI / 2), Math.cos(F.strike + Math.PI / 2)];
const fault = solveTrace([F.x, F.y], FS, FD, [-900, 900], [-500, 500], (x, y) => faultSide(x, y, topo(x, y)));
const C = FRAME.centre, AX = [Math.sin(FRAME.TREND * D), Math.cos(FRAME.TREND * D)], AC = [Math.cos(FRAME.TREND * D), -Math.sin(FRAME.TREND * D)];
// the antiform's axial trace, in two pieces (the fault offsets it): solve each side separately
const hingeAll = solveTrace([C.x, C.y], AX, AC, [-900, 900], [-420, 420], (x, y) => hingeAt(x, y, topo(x, y) - DEPTH));
const hinge = [[], []];
for (const p of hingeAll) { const x = BOX.x0 + p[0] * MPP, y = BOX.y1 - p[1] * MPP; hinge[faultSide(x, y, topo(x, y)) > 0 ? 0 : 1].push(p); }
lap('traces');

// the drillholes: collars and their plan traces to end of hole
const holes = drillholes().map((h) => ({ id: h.id, collar: toMap(h.x, h.y), trace: [0, h.length].map((d) => toMap(...h.at(d).slice(0, 2))) }));

// ── the plates: three sections across the fold, SW to NE, at 1 : 10 000 on 150 × 80 mm glass ────────────────
const PLATE = { w: 150, h: 80, px: 20, scale: 10000, ox: 11, oy: 9 };   // mm; the section's top-left on the glass
const SEC = { az: 130, half: 640, ztop: 380, zbot: -200 };
const SW = Math.round((2 * SEC.half) * 1000 / PLATE.scale * PLATE.px), SH = Math.round((SEC.ztop - SEC.zbot) * 1000 / PLATE.scale * PLATE.px);
const SM = (2 * SEC.half) / SW;   // m per px
const ux = Math.sin(SEC.az * D), uy = Math.cos(SEC.az * D);
// the plates go through the three drill fences
const plates = [['A', -180], ['B', 0], ['C', 180]].map(([name, a]) => {
  const cx = C.x + AX[0] * a, cy = C.y + AX[1] * a;
  const r = new Uint8Array(SW * SH);
  for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) {
    const x = cx + ux * ((i + 0.5) * SM - SEC.half), y = cy + uy * ((i + 0.5) * SM - SEC.half), z = SEC.ztop - (j + 0.5) * SM;
    if (!inBox(x, y)) continue;
    const u = lith(x, y, z); if (!u) continue;
    r[j * SW + i] = u | ((u === 4 || u === 9) && grade(x, y, z) >= 1 ? 0x80 : 0);
  }
  // drillholes within 60 m of the section plane, projected onto it (px in the section raster)
  const nx = Math.cos(SEC.az * D), ny = -Math.sin(SEC.az * D);
  const traces = drillholes().map((h) => {
    const pts = [];
    for (let d = 0; d <= h.length; d += 4) {
      const [x, y, z] = h.at(d);
      if (Math.abs((x - cx) * nx + (y - cy) * ny) < 60) pts.push([((x - cx) * ux + (y - cy) * uy + SEC.half) / SM, (SEC.ztop - z) / SM]);
    }
    return pts;
  }).filter((t) => t.length > 1);
  const ends = [[cx - ux * SEC.half, cy - uy * SEC.half], [cx + ux * SEC.half, cy + uy * SEC.half]];
  return { name, a, cx, cy, data: Buffer.from(r).toString('base64'), traces, line: ends };
});
lap('plates raster');
// the section lines on the map, clipped to the frame
const secLines = plates.map((p) => {
  const pts = []; for (let s = -SEC.half; s <= SEC.half; s += 4) { const x = p.cx + ux * s, y = p.cy + uy * s; if (inBox(x, y)) pts.push(toMap(x, y)); }
  return { name: p.name, a: pts[0], b: pts[pts.length - 1] };
});

// ── draw ─────────────────────────────────────────────────────────────────────────────────────────────────────
const font = async (f) => (await readFile(join(FONTS, f))).toString('base64');
const fonts = {
  'Barlow': await font('Barlow-Regular.ttf'), 'BarlowLight': await font('Barlow-Light.ttf'), 'BarlowMedium': await font('Barlow-Medium.ttf'),
  'BarlowItalic': await font('Barlow-Italic.ttf'), 'BarlowSC': await font('BarlowSemiCondensed-SemiBold.ttf'), 'BarlowSCLight': await font('BarlowSemiCondensed-Light.ttf'),
};
await mkdir(TEX, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.evaluate(async (fonts) => {
    for (const [name, b64] of Object.entries(fonts)) {
      const ff = new FontFace(name, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer); await ff.load(); document.fonts.add(ff);
    }
  }, fonts);
  await page.addScriptTag({ path: join(HERE, 'plates-draw.js') });
  const args = {
    NAME, PX, MAP, MW, MH, MPP, E0, N0, BOX, SCALE,
    units: Buffer.from(units).toString('base64'), contour: Buffer.from(contour).toString('base64'),
    UNITS, labels, dips, fault, faultDir: [FD[0], FD[1]], hinge, plunge: FRAME.PLUNGE, trend: FRAME.TREND, holes, secLines, contourLabels,
  };
  const map = await page.evaluate((a) => window.drawSheet(a), args);
  await writeFile(join(TEX, 'map.png'), Buffer.from(map, 'base64')); lap('map.png');
  for (const p of plates) {
    const png = await page.evaluate((a) => window.drawPlate(a), { NAME, PLATE, SW, SH, SEC, UNITS, plate: p });
    await writeFile(join(TEX, `plate-${p.name}.png`), Buffer.from(png, 'base64')); lap(`plate-${p.name}.png`);
  }
} finally { await browser.close(); }

await writeFile(join(HERE, 'plates.json'), JSON.stringify({
  note: 'micro cover: the sheet and the plates (mm); generated by plates-data.mjs',
  sheet: { w: 420, h: 297, texture: 'textures/map.png' },
  plate: { w: PLATE.w, h: PLATE.h, t: 3, textures: plates.map((p) => `textures/plate-${p.name}.png`) },
}, null, 1));
console.log('plates-data: done');
