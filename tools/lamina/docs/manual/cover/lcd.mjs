// the DD-60's LCD showing lamina: drawn at LCD resolution (256×192), scaled up pixel-sharp → lcd.png
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
const DIR = dirname(fileURLToPath(import.meta.url)) + '/';
mkdirSync(DIR, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage();
const png = await p.evaluate(() => {
  let s = 987654321;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff, s / 0x7fffffff);
  const randn = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const nx = 60, ny = 50, nz = 40, cx = nx / 2, cy = ny / 2, cz = nz * 0.45, rows = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const dxi = (i - cx) / nx, dyj = (j - cy) / ny, dzk = (k - cz) / nz;
    const ore = Math.exp(-(dxi * dxi * 4 + dyj * dyj * 4 + dzk * dzk * 6) * 3);
    const cu = Math.max(0, ore * 1.8 * Math.exp(0.5 * randn()) - 0.02), au = Math.max(0, ore * 1.2 * Math.exp(0.6 * randn()) - 0.01);
    randn(); randn(); randn(); randn();
    const depth = k / nz, lito = (cu < 0.05 && au < 0.05) ? 'WASTE' : depth < 0.25 ? 'OXIDE' : depth < 0.45 ? 'TRANS' : 'SULPH';
    rows.push({ id: rows.length + 1, z: 400 + k * 5, au, cu, lito });
  }
  const W = 256, H = 192, lime = '#c6d197', navy = '#1f3a72', inv = '#25499c';
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = lime; g.fillRect(0, 0, W, H);
  g.font = '8px monospace'; g.textBaseline = 'top';
  // header, inverse
  g.fillStyle = inv; g.fillRect(0, 0, W, 11); g.fillStyle = lime; g.fillText('SAMPLE_BLOCKMODEL.CSV  120,000 ROWS', 3, 2);
  const X = { id: 3, z: 40, au: 64, cu: 104, lito: 146, bar: 182 };
  g.fillStyle = navy; for (const [k, t] of [['id', 'ID'], ['z', 'Z'], ['au', 'Au_gpt'], ['cu', 'Cu_pct'], ['lito', 'LITO'], ['bar', 'Cu']]) g.fillText(t, X[k], 14);
  g.fillRect(0, 23, W, 1);
  const start = 55690;
  for (let r = 0; r < 15; r++) {
    const row = rows[start + r], y = 26 + r * 10;
    const hi = row.cu >= 1.0;                                      // the high grades, picked out inverse
    g.fillStyle = navy;
    g.fillText(String(row.id), X.id, y); g.fillText(String(row.z), X.z, y); g.fillText(row.au.toFixed(3), X.au, y);
    if (hi) { g.fillStyle = inv; g.fillRect(X.cu - 2, y - 1, 34, 10); g.fillStyle = lime; } else g.fillStyle = navy;
    g.fillText(row.cu.toFixed(3), X.cu, y);
    g.fillStyle = navy; g.fillText(row.lito, X.lito, y);
    g.fillRect(X.bar, y + 2, Math.round(Math.min(1, row.cu / 2.5) * 70), 4);   // the grade as an LCD bar
  }
  // the F-key tab bar, inverse
  const tabs = ['FILTER', 'SORT', 'RAW', 'LENS', 'MENU'];
  g.fillStyle = inv; g.fillRect(0, H - 12, W, 12);
  tabs.forEach((t, i) => { g.fillStyle = lime; g.fillText(t, 6 + i * 51, H - 10); if (i) { g.fillRect(i * 51, H - 11, 1, 10); } });
  // an LCD pixel is on or off: snap every pixel to the nearest of the three inks
  const id = g.getImageData(0, 0, W, H), P = [[0xc6, 0xd1, 0x97], [0x1f, 0x3a, 0x72], [0x25, 0x49, 0x9c]];
  for (let i = 0; i < id.data.length; i += 4) {
    let best = 0, bd = 1e9; for (let k = 0; k < 3; k++) { const d = (id.data[i] - P[k][0]) ** 2 + (id.data[i + 1] - P[k][1]) ** 2 + (id.data[i + 2] - P[k][2]) ** 2; if (d < bd) { bd = d; best = k; } }
    // text drawn lime on inverse: keep it lime where it was lighter than the inverse
    id.data[i] = P[best][0]; id.data[i + 1] = P[best][1]; id.data[i + 2] = P[best][2];
  }
  g.putImageData(id, 0, 0);
  // scale up pixel-sharp, with a faint pixel grid
  const S = 6, out = document.createElement('canvas'); out.width = W * S; out.height = H * S; const o = out.getContext('2d');
  o.imageSmoothingEnabled = false; o.drawImage(c, 0, 0, W * S, H * S);
  o.fillStyle = 'rgba(150,165,110,0.16)';
  for (let x = 0; x < W; x++) o.fillRect(x * S + S - 1, 0, 1, H * S);
  for (let y = 0; y < H; y++) o.fillRect(0, y * S + S - 1, W * S, 1);
  return out.toDataURL('image/png');
});
writeFileSync(DIR + 'lcd.png', Buffer.from(png.split(',')[1], 'base64'));
await b.close(); console.log('lcd ok');
