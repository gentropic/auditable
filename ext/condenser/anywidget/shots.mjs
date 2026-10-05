// Regenerate docs/hero.png — the README's face. Harness-generated (the real
// Python packer, the real built widget, a synthetic deposit), so it never rots:
//   node ext/condenser/anywidget/shots.mjs      (from the repo root)
import { chromium } from 'playwright';
import http from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { extname, join } from 'path';

const VENV = ['ext/condenser/anywidget/.venv/Scripts/python.exe', 'ext/condenser/anywidget/.venv/bin/python']
  .find((p) => existsSync(p));
const TMP = join(process.env.CLAUDE_JOB_DIR || '.', 'tmp');
await mkdir(TMP, { recursive: true });
await mkdir('ext/condenser/anywidget/docs', { recursive: true });
const T = TMP.replace(/\\/g, '\\\\');

const PY = `
import json, numpy as np, gcu.condenser as cd
rng = np.random.default_rng(7)
gi, gj, gk = np.meshgrid(np.arange(40), np.arange(40), np.arange(12), indexing="ij")
X = gi.ravel()*10.0+5; Y = gj.ravel()*10.0+5; Z = gk.ravel()*10.0+5
ore = np.exp(-(((X-200)/120)**2 + ((Y-180)/90)**2 + ((Z-45)/35)**2)*3)
FE = 15 + 45*ore + rng.normal(0, 2.5, X.size)
hid = ["DH%02d" % n for n in range(12)]
collar = dict(BHID=hid, X=[60+n%4*90.0 for n in range(12)], Y=[80+n//4*110.0 for n in range(12)], Z=[185.0]*12)
survey = dict(BHID=np.repeat(hid,3), DEPTH=np.tile([0.,60,120],12), AZ=np.tile([135.,135,137],12), DIP=np.tile([-62.,-64,-67],12))
frm = np.tile(np.arange(0,120,2.0),12)
assay = dict(BHID=np.repeat(hid,60), FROM=frm, TO=frm+2, AU=np.clip(rng.gamma(2,.4,720)*(1+2*rng.random(720)),0,9))
ty, tx = np.mgrid[0:45, 0:45]
dem = 170 + 18*np.sin(tx/7) + 14*np.cos(ty/6)
w = cd.view(
  cd.blocks(dict(X=X,Y=Y,Z=Z,FE=FE), x="X", y="Y", z="Z", value="FE", name="FE model",
            threshold=[30, 99], clip=[30, 48], ramp="turbo"),
  cd.drillholes(collar, survey, assay, value="AU", radius=2.2, name="holes", labels=True),
  cd.surface(dem, origin=(0.0, 440.0), pitch=10.0, name="topo", color="#5a6670", opacity=0.35, sectioned=False),
  height=640,
)
open(r"${T}/hero.bin", "wb").write(w._payload)
open(r"${T}/hero-styles.json", "w").write(json.dumps(w._styles))
print("packed", len(w._payload))
`;
console.log(execFileSync(VENV || 'python', ['-c', PY], { encoding: 'utf8' }).trim());

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.bin': 'application/octet-stream', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const data = await readFile(p.startsWith('/tmp/') ? join(TMP, p.slice(5)) : '.' + p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
await writeFile(join(TMP, 'hero.html'), '<!doctype html><meta charset=utf-8><body style="margin:0;background:#0d0d0d"><div id=host style="width:1200px;height:640px"></div>');

const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 640 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(`http://127.0.0.1:${PORT}/tmp/hero.html`, { waitUntil: 'load' });

await page.evaluate(async (port) => {
  const mod = await import(`http://127.0.0.1:${port}/ext/condenser/anywidget/gcu/condenser/static/widget.js`);
  const state = new Map(Object.entries({
    _payload: new DataView(await (await fetch(`http://127.0.0.1:${port}/tmp/hero.bin`)).arrayBuffer()),
    _styles: await (await fetch(`http://127.0.0.1:${port}/tmp/hero-styles.json`)).json(),
    _fit: 0, section: { axis: 'y', position: 185, thickness: 400 }, background: '#111416',
    height: 640, edl: true, edl_strength: 1.1, budget: 3000000, selection: {},
    camera: { azimuth: 318, plunge: 17, distance: 700, target: [205, 205, 60], n: 1 },
  }));
  const subs = new Map();
  mod.default.render({
    model: {
      get: (k) => state.get(k),
      set: (k, v) => { state.set(k, v); for (const f of subs.get('change:' + k) || []) f(); },
      on: (ev, f) => { if (!subs.has(ev)) subs.set(ev, []); subs.get(ev).push(f); },
      off: () => {}, save_changes: () => {}, send: () => {},
    },
    el: document.querySelector('#host'),
  });
}, PORT);
await page.waitForTimeout(3500);                           // accumulation + overlay settle
await page.locator('#host').screenshot({ path: 'ext/condenser/anywidget/docs/hero.png' });
console.log('wrote ext/condenser/anywidget/docs/hero.png');
await browser.close();
server.close();
