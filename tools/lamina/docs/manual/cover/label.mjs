// the caddy's label, printed: dark mauve-brown, white type, after the EB caddies → label.png (28 × 64 mm at 40 px/mm)
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'label.png');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1120, height: 2560 }, deviceScaleFactor: 1 });
await p.setContent(`<html><body style="margin:0;width:1120px;height:2560px;background:#2b171a;color:#f2ece6;font-family:Arial,Helvetica,sans-serif;position:relative">
  <div style="position:absolute;left:70px;top:70px;font:bold 92px Georgia,serif;letter-spacing:6px">GCU</div>
  <div style="position:absolute;right:70px;top:58px;width:200px;height:120px;border:6px solid #f2ece6;display:flex;align-items:center;justify-content:center;font:bold 66px Arial;letter-spacing:2px">D3XA</div>
  <div style="position:absolute;left:0;right:0;top:230px;height:84px;background:#d9cfc6;color:#2b171a;font:bold 50px Arial;display:flex;align-items:center;justify-content:center">Electronic Book</div>
  <div style="position:absolute;left:70px;top:380px;font:bold 150px Arial;letter-spacing:-2px">lamina</div>
  <div style="position:absolute;left:70px;top:580px;font:52px 'Courier New',monospace;line-height:84px">SAMPLE_BLOCKMODEL.CSV<br>120,000 rows · 16 columns<br>+ grade–tonnage<br>+ group by · data quality</div>
  <div style="position:absolute;left:70px;top:1010px;padding:10px 24px;border:5px solid #f2ece6;font:bold 50px Arial">read-only · never resident</div>
  <div style="position:absolute;left:70px;top:1130px;padding:10px 24px;border:5px solid #f2ece6;font:bold 50px Arial">networkless</div>
  <div style="position:absolute;left:70px;top:1300px;font:46px Arial;line-height:66px;color:#d9cfc6">YRRS-53<br>sample block model, generated in-page<br>© Geoscientific Chaos Union 2026</div>
  <div style="position:absolute;left:70px;bottom:120px;font:44px Arial;color:#d9cfc6">gentropic.org/lamina</div>
  <div style="position:absolute;right:70px;bottom:100px;width:150px;height:110px;border:5px solid #d9cfc6;border-radius:8px;display:flex;align-items:center;justify-content:center;font:bold 40px Arial;color:#d9cfc6;line-height:42px;text-align:center">8 cm<br>DATA</div>
</body></html>`);
writeFileSync(OUT, await p.screenshot({ type: 'png' }));
await b.close(); console.log('label ok');
