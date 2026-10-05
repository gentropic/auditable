// @gcu/condenser anywidget — the CROSS-LANGUAGE guard. The Python packer
// really runs (in the package's own uv venv), its bytes really cross into a
// real browser, and the real built widget ESM really renders them. That is the
// only shape that can catch a wire-format drift between the two halves, which
// is the whole risk surface of a widget.
//
//   uv venv ext/condenser/anywidget/.venv
//   uv pip install --python ext/condenser/anywidget/.venv -e ext/condenser/anywidget
//   node test/condenser-widget.mjs
import { chromium } from 'playwright';
import http from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { extname, join } from 'path';

// the package's own venv — never the machine's global python
const VENV = ['ext/condenser/anywidget/.venv/Scripts/python.exe', 'ext/condenser/anywidget/.venv/bin/python']
  .find((p) => existsSync(p));
const PYTHON = VENV || 'python';

const TMP = join(process.env.CLAUDE_JOB_DIR || '.', 'tmp');
await mkdir(TMP, { recursive: true });
const T = TMP.replace(/\\/g, '\\\\');

// ── 1. the Python half: a stack that uses every kind + sub-blocking ──
const PY = `
import json, numpy as np, gcu.condenser as cd

# a SUB-BLOCKED model: 20 m parents with a 10 m core
xs, ys, zs, dx, dy, dz, val = [], [], [], [], [], [], []
for k in range(4):
    for j in range(8):
        for i in range(8):
            if 2 <= i < 6 and 2 <= j < 6:
                for a in range(2):
                    for b in range(2):
                        for c in range(2):
                            xs.append(i*20+5+a*10); ys.append(j*20+5+b*10); zs.append(k*20+5+c*10)
                            dx.append(10.); dy.append(10.); dz.append(10.); val.append(30.+i+j)
            else:
                xs.append(i*20+10); ys.append(j*20+10); zs.append(k*20+10)
                dx.append(20.); dy.append(20.); dz.append(20.); val.append(5.+i)
model = cd.blocks(np.array(xs,float), np.array(ys,float), np.array(zs,float),
                  value=np.array(val), size=(np.array(dx), np.array(dy), np.array(dz)),
                  name="model", ramp="turbo")

# drillholes through it
rng = np.random.default_rng(2)
cid, cx, cy, cz = [], [], [], []
sid, sd, sa, sdp = [], [], [], []
iid, ifr, ito, iau = [], [], [], []
for hn in range(6):
    hid = "DH%02d" % hn
    cid.append(hid); cx.append(40.+hn*25); cy.append(60.); cz.append(120.)
    for d in (0, 40, 80):
        sid.append(hid); sd.append(float(d)); sa.append(90.+hn*3); sdp.append(-60.-d*0.05)
    for f in range(0, 80, 2):
        iid.append(hid); ifr.append(float(f)); ito.append(float(f+2)); iau.append(float(rng.random()*5))
holes = cd.drillholes({"BHID":cid,"X":cx,"Y":cy,"Z":cz}, {"BHID":sid,"DEPTH":sd,"AZ":sa,"DIP":sdp},
                      {"BHID":iid,"FROM":ifr,"TO":ito,"AU":iau}, value="AU", radius=2.5, name="holes")

# a topo cloud, exempt from the section
n = 30000
px = rng.random(n)*160; py = rng.random(n)*160; pz = 150 + np.sin(px/25)*8 + np.cos(py/30)*6
topo = cd.points(px, py, pz, value=pz, name="topo", sectioned=False)

# the DATAFRAME-shaped path: size given as COLUMN NAMES, and a scalar size.
# np.isscalar("DIMX") is True, so a name once reached float() -- guard it.
tbl = {"XC": np.array(xs, float), "YC": np.array(ys, float), "ZC": np.array(zs, float),
       "DIMX": np.array(dx), "DIMY": np.array(dy), "DIMZ": np.array(dz), "CU": np.array(val)}
by_name = cd.blocks(tbl, x="XC", y="YC", z="ZC", value="CU", size=("DIMX", "DIMY", "DIMZ"))
flat = np.arange(27.0)
scalar_size = cd.blocks(np.repeat(np.arange(3.), 9) * 10, np.tile(np.repeat(np.arange(3.), 3), 3) * 10,
                        np.tile(np.arange(3.), 9) * 10, value=flat, size=(10, 10, 10))
assert by_name.count == model.count, "size-by-name lost rows"
assert len(by_name._extra["dim_palette"]) == 2, "size-by-name lost the palette"
assert scalar_size.count == 27, "scalar size failed"

w = cd.view(model, holes, topo, height=460)
open(r"${T}/multi.bin", "wb").write(w._payload)
open(r"${T}/styles.json", "w").write(json.dumps(w._styles))

# STREAMED (cd.open): a callable batch source — no pyarrow needed. The payload
# carries only the header; the rows are dumped as the exact (content, buffers)
# messages _stream_messages would send, for the browser half to replay.
gi, gj, gk = np.meshgrid(np.arange(20), np.arange(20), np.arange(10), indexing="ij")
sxx = (gi.ravel()*10+5).astype(float); syy = (gj.ravel()*10+5).astype(float); szz = (gk.ravel()*10+5).astype(float)
svv = sxx/10 + szz/100
scc = np.where(sxx < 100, "OX", "SUL")
half = sxx.size // 2
bat = [{"X": sxx[:half], "Y": syy[:half], "Z": szz[:half], "V": svv[:half], "C": scc[:half]},
       {"X": sxx[half:], "Y": syy[half:], "Z": szz[half:], "V": svv[half:], "C": scc[half:]}]
streamed = cd.open(lambda: iter(bat), x="X", y="Y", z="Z", value="V", category="C", name="streamed")
assert streamed._extra["streamed"] is True and streamed.count == sxx.size
ws = cd.view(streamed, height=460)

import io
TD = r"${T}"
def dump_stream(w2, tag):
    manifest, blob = [], io.BytesIO()
    for content, bl in w2._stream_messages("E"):
        lens = []
        for b in bl:
            bb = np.ascontiguousarray(b).tobytes()
            lens.append(len(bb)); blob.write(bb)
        manifest.append({"content": content, "lens": lens})
    open(f"{TD}/{tag}-msgs.json", "w").write(json.dumps(manifest))
    open(f"{TD}/{tag}-bufs.bin", "wb").write(blob.getvalue())
    open(f"{TD}/{tag}.bin", "wb").write(w2._payload)
    open(f"{TD}/{tag}-styles.json", "w").write(json.dumps(w2._styles))
    return manifest, blob.getbuffer().nbytes
manifest, blob_n = dump_stream(ws, "stream")

# streamed POINTS + streamed SUB-BLOCKED stacked in one view
pn = 3000
rng2 = np.random.default_rng(7)
ppx = rng2.random(pn)*200; ppy = rng2.random(pn)*200; ppz = 120 + rng2.random(pn)*20
pbat = [{"X": ppx[:1500], "Y": ppy[:1500], "Z": ppz[:1500], "V": ppz[:1500]},
        {"X": ppx[1500:], "Y": ppy[1500:], "Z": ppz[1500:], "V": ppz[1500:]}]
spts = cd.open(lambda: iter(pbat), kind="points", x="X", y="Y", z="Z", value="V", name="spts")
assert spts._extra["streamed"] and len(spts._extra["pos_origin"]) == 3
sbat = [{"X": np.array(xs, float), "Y": np.array(ys, float), "Z": np.array(zs, float),
         "DX": np.array(dx), "DY": np.array(dy), "DZ": np.array(dz), "V": np.array(val)}]
ssub = cd.open(lambda: iter(sbat), x="X", y="Y", z="Z", value="V", size=("DX", "DY", "DZ"), name="ssub")
assert ssub._extra["sub_blocked"] and len(ssub._extra["dim_palette"]) == 2
assert [a[1] for a in ssub._extra["axes"]] == [5.0, 5.0, 5.0], ssub._extra["axes"]
wsp = cd.view(spts, ssub, height=460)
dump_stream(wsp, "stream2")

# BATCH A: multi-channel values + categories (legend/eyes) + a draped surface
nxg, nyg = 30, 30
gxa, gya = np.meshgrid(np.arange(nxg)*10.+5, np.arange(nyg)*10.+5, indexing="ij")
bxa = np.tile(gxa.ravel(), 3); bya = np.tile(gya.ravel(), 3)
bza = np.repeat(np.array([15., 25., 35.]), nxg*nyg)
fe = bxa/30 + bza/10; si = 100 - fe*2
dom = np.where(bya < 150, "OX", "SUL")
tblA = {"X": bxa, "Y": bya, "Z": bza, "FE": fe, "SIO2": si, "DOM": dom}
mc = cd.blocks(tblA, x="X", y="Y", z="Z", value=["FE", "SIO2"], category="DOM", name="mc")
assert mc._extra["value_channels"] == ["FE", "SIO2"], mc._extra.get("value_channels")
assert mc.value == "FE"
dem = 60 + np.fromfunction(lambda r, c: np.sin(c/6)*6 + np.cos(r/7)*5, (nyg+10, nxg+10))
dem[5:9, 5:9] = -9999.0
drp = np.fromfunction(lambda r, c: c*1.0, dem.shape)
surf2 = cd.surface(dem, origin=(0.0, 300.0), pitch=8.0, drape=drp, nodata=-9999, name="dem")
assert surf2._extra["value_range"][1] > 30, surf2._extra["value_range"]   # the DRAPE's range, not z's
wa = cd.view(mc, surf2, height=460)
open(r"${T}/batcha.bin", "wb").write(wa._payload)
open(r"${T}/batcha-styles.json", "w").write(json.dumps(wa._styles))

# via='files': the kernel never reads the file — it only NAMES it
fcsv = "XC,YC,ZC,FE\\n" + "\\n".join(
    f"{i*10+5},{j*10+5},{k*10+5},{(i+j+k)/3:.4f}"
    for i in range(12) for j in range(12) for k in range(4))
open(f"{TD}/files-model.csv", "w").write(fcsv)
fl = cd.open(f"{TD}/files-model.csv", via="files")
assert fl.count == 0 and fl._extra["file"]["candidates"], fl._extra
wf = cd.view(fl, height=460)
open(f"{TD}/files.bin", "wb").write(wf._payload)
open(f"{TD}/files-styles.json", "w").write(json.dumps(wf._styles))

# MESH: a context surface co-registered over the block model
mg = np.arange(0, 11) * 20.0
mvx, mvy = np.meshgrid(mg, mg, indexing="ij")
mvz = 130 + np.sin(mvx/40)*12 + np.cos(mvy/50)*9
mverts = np.column_stack([mvx.ravel(), mvy.ravel(), mvz.ravel()])
mtris = []
for i2 in range(10):
    for j2 in range(10):
        a2 = i2*11+j2; b2 = a2+1; c2 = a2+11; d2 = c2+1
        mtris += [[a2, c2, b2], [b2, c2, d2]]
surf = cd.mesh(mverts, np.array(mtris), color="#4477aa", name="topo-mesh")
assert surf.count == 200 and surf._extra["vertex_count"] == 121
wm = cd.view(model, surf, height=460)
open(r"${T}/mesh.bin", "wb").write(wm._payload)
open(r"${T}/mesh-styles.json", "w").write(json.dumps(wm._styles))

print(json.dumps({
  "bytes": len(w._payload), "layers": [l.name for l in w.layers],
  "blocks": model.count, "intervals": holes.count, "points": topo.count,
  "palette": len(model._extra["dim_palette"]), "pitch": [a[1] for a in model._extra["axes"]],
  "holes": holes._extra["holes"],
  "byName": by_name.count, "byNamePalette": len(by_name._extra["dim_palette"]),
  "scalarSize": scalar_size.count,
  "streamCount": streamed.count, "streamBytes": len(ws._payload),
  "streamMsgs": len(manifest), "streamBufBytes": blob_n,
  "streamCats": streamed._extra["cat_labels"],
  "s2Points": spts.count, "s2Blocks": ssub.count, "s2Palette": len(ssub._extra["dim_palette"]),
  "meshTris": surf.count, "meshVerts": surf._extra["vertex_count"], "meshBytes": len(wm._payload),
  "mcChannels": mc._extra["value_channels"], "mcRanges": mc._extra["value_ranges"],
  "mcCats": mc._extra["cat_labels"], "surfCells": surf2.count,
}))
`;
let meta;
try {
  meta = JSON.parse(execFileSync(PYTHON, ['-c', PY], { encoding: 'utf8', cwd: process.cwd() }).trim().split('\n').pop());
} catch (e) {
  console.log('FAIL: the Python half did not run —', (e.stderr || e.message || '').toString().trim().split('\n').slice(-4).join('\n'));
  if (!VENV) console.log('     (no .venv — run: uv venv ext/condenser/anywidget/.venv && uv pip install --python ext/condenser/anywidget/.venv -e ext/condenser/anywidget)');
  process.exit(1);
}
console.log(`ok   python packed ${meta.layers.join(' + ')} → ${(meta.bytes / 1024).toFixed(0)} KB`
  + ` (${meta.blocks} blocks / ${meta.intervals} intervals / ${meta.points.toLocaleString()} points)`);
console.log(`ok   sub-blocked lattice: fine pitch ${JSON.stringify(meta.pitch)}, ${meta.palette} block sizes, ${meta.holes} holes`);
console.log(`ok   size= accepts COLUMN NAMES (${meta.byName} blocks, ${meta.byNamePalette} sizes) and scalars (${meta.scalarSize} blocks)`);
console.log(`ok   cd.open streamed ${meta.streamCount.toLocaleString()} blocks as a ${meta.streamBytes}-byte HEADER`
  + ` + ${meta.streamMsgs} messages (${(meta.streamBufBytes / 1024).toFixed(0)} KB wire, cats ${JSON.stringify(meta.streamCats)})`);
if (meta.streamBytes > 4096) { console.log('FAIL streamed payload is not header-only'); process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.bin': 'application/octet-stream', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // /files/<path> emulates jupyter-server: byte ranges on the files endpoint
    // (mapped by basename into TMP — the guard's files live there)
    const fp = p.startsWith('/files/') ? join(TMP, p.split('/').pop())
      : p.startsWith('/tmp/') ? join(TMP, p.slice(5)) : '.' + p;
    const data = await readFile(fp);
    const rng = req.headers.range && req.headers.range.match(/bytes=(\d+)-(\d*)/);
    if (rng) {
      const a = +rng[1];
      const b = rng[2] ? Math.min(+rng[2], data.length - 1) : data.length - 1;
      res.writeHead(206, {
        'content-type': MIME[extname(p)] || 'application/octet-stream',
        'content-range': `bytes ${a}-${b}/${data.length}`, 'accept-ranges': 'bytes',
      });
      res.end(data.subarray(a, b + 1));
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'accept-ranges': 'bytes' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
await writeFile(join(TMP, 'host.html'), '<!doctype html><meta charset=utf-8><body style="margin:0;background:#111"><div id=host style="width:760px;height:460px"></div>');

const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/tmp/host.html`, { waitUntil: 'load' });

let fails = 0;
const chk = (name, cond, extra) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  — ' + extra : ''}`); if (!cond) fails++; };

const r = await page.evaluate(async (port) => {
  const mod = await import(`http://127.0.0.1:${port}/ext/condenser/anywidget/gcu/condenser/static/widget.js`);
  const render = mod.default && mod.default.render;
  if (!render) return { err: 'no default.render export' };

  const makeModel = (init) => {
    const state = new Map(Object.entries(init));
    const subs = new Map();
    const sent = [];
    return {
      get: (k) => state.get(k),
      set: (k, v) => { state.set(k, v); for (const f of subs.get('change:' + k) || []) f(); },
      on: (ev, f) => { if (!subs.has(ev)) subs.set(ev, []); subs.get(ev).push(f); },
      off: (ev, f) => { const a = subs.get(ev) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
      save_changes: () => {},
      send: (content) => { sent.push(content); },          // JS → kernel custom message
      _sent: sent,
      _deliver: (content, buffers) => { for (const f of [...(subs.get('msg:custom') || [])]) f(content, buffers); },
      _get: (k) => state.get(k),
    };
  };
  const settle = () => new Promise((res) => setTimeout(res, 800));
  const lit = () => {
    const cv = document.querySelector('#host canvas');
    const gl = cv.getContext('webgl2');
    const px = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0, sig = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i] > 30 || px[i + 1] > 30 || px[i + 2] > 30) n++; sig += px[i] + px[i + 1] * 2 + px[i + 2] * 3; }
    return { n, sig };
  };

  const payload = new DataView(await (await fetch(`http://127.0.0.1:${port}/tmp/multi.bin`)).arrayBuffer());
  const styles = await (await fetch(`http://127.0.0.1:${port}/tmp/styles.json`)).json();
  const el = document.querySelector('#host');
  const out = {};
  const model = makeModel({
    _payload: payload, _styles: styles, _fit: 0, section: null,
    background: '#121212', height: 460, edl: true, edl_strength: 1, budget: 3000000, selection: {},
  });
  const dispose = render({ model, el });
  await settle(); await settle();

  const base = lit();
  out.baseLit = base.n;
  out.hud = (el.querySelector('.cdhud') || {}).textContent;

  const patch = (i, p) => { model.set('_styles', styles.map((x, k) => (k === i ? { ...x, ...p } : x))); };

  // per-layer visibility
  patch(0, { visible: false }); await settle();
  out.hiddenLit = lit().n;
  model.set('_styles', styles); await settle();
  out.restoredLit = lit().n;

  // per-layer threshold — carves the block model, leaves the others alone
  patch(0, { threshold: [25, 99] }); await settle();
  out.thrLit = lit().n;
  model.set('_styles', styles); await settle();

  // SECTION: a thin slab cuts; topo is sectioned:false so it survives — proven
  // by comparing against a run where every layer IS sectioned
  model.set('section', { axis: 'y', position: 60, thickness: 20 }); await settle();
  out.sectionLit = lit().n;
  model.set('_styles', styles.map((x) => ({ ...x, sectioned: true }))); await settle();
  out.sectionAllLit = lit().n;
  model.set('_styles', styles); model.set('section', null); await settle();

  // ── the TOOLBAR ──
  const host = el.querySelector('div');
  out.tbButtons = host.querySelectorAll('.cdt button').length;
  const toolBtn = (p) => [...host.querySelectorAll('.cdt button')].find((b) => (b.title || '').startsWith(p));
  out.legendShown = !!host.querySelector('.cdleg') && host.querySelector('.cdleg').style.display !== 'none';

  // layers popover → toggling a checkbox must reach _styles (and so Python)
  const layersBtn = [...host.querySelectorAll('.cdt button')].find((b) => (b.title || '').startsWith('Layers'));
  layersBtn.click();
  await new Promise((res) => setTimeout(res, 120));
  const boxes = [...host.querySelectorAll('.cdpop input[type=checkbox]')];
  out.popRows = boxes.length;
  if (boxes.length) { boxes[0].checked = false; boxes[0].dispatchEvent(new Event('change')); }
  await settle();
  out.tbHidLit = lit().n;
  out.tbStylesVisible = (model._get('_styles')[0] || {}).visible;
  if (boxes.length) { boxes[0].checked = true; boxes[0].dispatchEvent(new Event('change')); }
  await settle();

  // KNIFE: arm it, drag across the view, expect a section with a free normal
  const knifeBtn = [...host.querySelectorAll('.cdt button')].find((b) => (b.title || '').startsWith('Knife'));
  knifeBtn.click();
  const cv0 = document.querySelector('#host canvas');
  const r0 = cv0.getBoundingClientRect();
  await new Promise((res) => setTimeout(res, 60));
  const kp = (t2, x, y) => host.dispatchEvent(new PointerEvent(t2, { clientX: x, clientY: y, bubbles: true }));
  kp('pointerdown', r0.left + r0.width * 0.3, r0.top + r0.height * 0.35);
  kp('pointermove', r0.left + r0.width * 0.5, r0.top + r0.height * 0.5);
  const bandSvg = host.querySelector('.cdknife');
  out.bandShown = bandSvg.style.display !== 'none';
  // an SVG with no width/height gets a 300x150 intrinsic box and CLIPS the line
  // — 'display != none' was true while nothing was visible. Assert the BOX.
  out.bandBox = Math.round(bandSvg.getBoundingClientRect().width);
  out.bandCaps = bandSvg.querySelectorAll('circle').length;
  out.knifeCursor = getComputedStyle(cv0).cursor;
  kp('pointerup', r0.left + r0.width * 0.7, r0.top + r0.height * 0.65);
  await settle();
  out.knifeSection = model._get('section');
  out.scrubShown = host.querySelector('.cdsec') && host.querySelector('.cdsec').style.display !== 'none';
  // the scrub bar: the slider must NOT move as the readout's width changes
  {
    const bar = host.querySelector('.cdsec');
    const rng = bar.querySelector('input[type=range]');
    const lbl = bar.querySelector('.lbl');
    const pos = [], labels = [];
    for (const v of [0, 500, 1000]) {
      rng.value = String(v); rng.dispatchEvent(new Event('input'));
      await new Promise((res) => setTimeout(res, 220));
      pos.push(Math.round(rng.getBoundingClientRect().left));
      labels.push(lbl.textContent);
    }
    out.scrubSpread = Math.max(...pos) - Math.min(...pos);
    out.scrubLabels = labels;
  }
  model.set('section', null); await settle();

  // a SECOND view of the same widget must come up matching its stored camera —
  // _view used to be change-only, so a re-display ignored it
  model.set('_view', { name: 'north', ortho: true, n: 1 });
  await settle();
  const el2 = document.createElement('div');
  el2.style.cssText = 'width:300px;height:200px';
  document.body.appendChild(el2);
  const d2 = render({ model, el: el2 });
  await settle();
  out.orthoBefore = false;
  out.orthoAfter = el2.querySelector('.cdt button[title^="Parallel"]').getAttribute('aria-pressed') === 'true';
  d2(); el2.remove();

  // ── RECTANGLE selection: drag a box, get rows back in the packed wire format
  // that gcu.condenser decodes (u32 n, then per layer: idx, count, rows...) ──
  const cvS = document.querySelector('#host canvas');
  const rS = cvS.getBoundingClientRect();
  const drag = (from, to, path) => {
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: from[0], clientY: from[1], bubbles: true }));
    for (const p of (path || [to])) host.dispatchEvent(new PointerEvent('pointermove', { clientX: p[0], clientY: p[1], bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { clientX: to[0], clientY: to[1], bubbles: true }));
  };
  const unpack = (dv) => {
    if (!dv || dv.byteLength < 4) return {};
    const out2 = {}; const n = dv.getUint32(0, true); let off = 4;
    for (let q = 0; q < n; q++) {
      const li = dv.getUint32(off, true), count = dv.getUint32(off + 4, true);
      off += 8;
      const rows = [];
      for (let z = 0; z < count; z++) { rows.push(dv.getUint32(off, true)); off += 4; }
      out2[li] = rows;
    }
    return out2;
  };
  toolBtn('Rectangle').click();
  out.rectCursor = getComputedStyle(cvS).cursor;
  drag([rS.left + rS.width * 0.30, rS.top + rS.height * 0.30],
       [rS.left + rS.width * 0.62, rS.top + rS.height * 0.66],
       [[rS.left + rS.width * 0.45, rS.top + rS.height * 0.5], [rS.left + rS.width * 0.62, rS.top + rS.height * 0.66]]);
  await settle();
  out.rectSel = unpack(model._get('_sel_rows'));
  out.rectLit = lit().sig;
  const totalOf = (o) => Object.values(o).reduce((a, v) => a + v.length, 0);
  out.rectTotal = totalOf(out.rectSel);

  // THROUGH: the same box, but sweeping the volume behind the surface. A solid
  // block model hides most of itself, so this must catch strictly MORE.
  model.set('_clear_sel', 90); await settle();
  toolBtn('Select through').click();
  out.throughOn = model._get('select_through');
  drag([rS.left + rS.width * 0.30, rS.top + rS.height * 0.30],
       [rS.left + rS.width * 0.62, rS.top + rS.height * 0.66],
       [[rS.left + rS.width * 0.45, rS.top + rS.height * 0.5], [rS.left + rS.width * 0.62, rS.top + rS.height * 0.66]]);
  await settle();
  out.throughSel = unpack(model._get('_sel_rows'));
  out.throughTotal = Object.values(out.throughSel).reduce((a, v) => a + v.length, 0);
  // …and a surface selection is a SUBSET of the through selection (same box)
  // how much of the surface set does the tube contain? Not 100%: the tube tests
  // an element's CENTER, the surface tests its rendered PIXELS, so an element
  // straddling the marquee edge can be caught by one and not the other.
  {
    let inBoth = 0, total = 0, missByLayer = {};
    for (const [li, rows] of Object.entries(out.rectSel)) {
      const big = new Set(out.throughSel[li] || []);
      let miss = 0;
      for (const r of rows) { total++; if (big.has(r)) inBoth++; else miss++; }
      if (miss) missByLayer[li] = miss;
    }
    out.subsetFrac = total ? inBoth / total : 0;
    out.subsetMiss = missByLayer;
    out.subsetTotal = total;
  }
  toolBtn('Select through').click();                       // back to surface
  out.throughOff = model._get('select_through');
  model.set('_clear_sel', 91); await settle();

  // LASSO over a deliberately smaller loop → strictly fewer rows
  model.set('_clear_sel', 1); await settle();
  toolBtn('Lasso').click();
  const cx0 = rS.left + rS.width * 0.46, cy0 = rS.top + rS.height * 0.48, rad = Math.min(rS.width, rS.height) * 0.11;
  const loop = [];
  for (let a = 0; a <= 18; a++) { const th = (a / 18) * Math.PI * 2; loop.push([cx0 + Math.cos(th) * rad, cy0 + Math.sin(th) * rad]); }
  drag(loop[0], loop[loop.length - 1], loop);
  await settle();
  out.lassoSel = unpack(model._get('_sel_rows'));
  out.lassoTotal = totalOf(out.lassoSel);

  // clearing from Python drops the wash
  model.set('_clear_sel', 2); await settle();
  out.clearedTotal = totalOf(unpack(model._get('_sel_rows')));

  // ── MEASURE: two clicks on elements → distance, bearing, plunge ──
  toolBtn('Measure').click();
  const clickAt = (x, y) => {
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
  };
  let meas = {};
  outer: for (const A of [[0.42, 0.44], [0.46, 0.5], [0.5, 0.46]]) {
    for (const B of [[0.58, 0.58], [0.55, 0.62], [0.6, 0.52]]) {
      model.set('measurement', {});
      clickAt(rS.left + rS.width * A[0], rS.top + rS.height * A[1]); await settle();
      clickAt(rS.left + rS.width * B[0], rS.top + rS.height * B[1]); await settle();
      meas = model._get('measurement') || {};
      if (meas.distance) break outer;
    }
  }
  out.measurement = meas;
  out.measBandShown = host.querySelector('.cdknife').style.display !== 'none';
  toolBtn('Pick').click();

  // pick → layer + row
  const cv = document.querySelector('#host canvas');
  const rect = cv.getBoundingClientRect();
  let sel = {};
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.5, 0.62], [0.4, 0.45]]) {
    const cx = rect.left + rect.width * fx, cy = rect.top + rect.height * fy;
    cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }));
    cv.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true }));
    await settle();
    sel = model._get('selection') || {};
    if (sel.row != null && sel.row >= 0) break;
  }
  out.selection = sel;
  out.pickBoxShown = host.querySelector('.cdpick') && host.querySelector('.cdpick').style.display !== 'none';
  out.pickBoxText = (host.querySelector('.cdpick') || {}).textContent || '';

  // ── decorations overlay: figure chrome ink + hole labels ──
  const decoInk = () => {
    const dc = host.querySelectorAll('canvas')[1];         // the 2D overlay
    if (!dc || !dc.width) return -1;
    const dd = dc.getContext('2d').getImageData(0, 0, dc.width, dc.height).data;
    let n3 = 0;
    for (let q = 3; q < dd.length; q += 4) if (dd[q] > 10) n3++;
    return n3;
  };
  out.decoBase = decoInk();                                // scale bar + north arrow
  patch(1, { labels: true }); await settle();
  out.decoLabels = decoInk();                              // + 6 BHIDs
  patch(1, { labels: false });
  model.set('decorations', false); await settle();
  out.decoOff = decoInk();
  model.set('decorations', true); await settle();

  let disposeErr = null;
  try { dispose(); } catch (e) { disposeErr = e.message; }
  out.disposeErr = disposeErr;
  out.emptied = el.children.length === 0;

  // a malformed payload must degrade, not explode
  const m3 = makeModel({ _payload: new DataView(new ArrayBuffer(4)), _styles: [], _fit: 0, section: null, background: '#121212', height: 200, edl: true, edl_strength: 1, budget: 1e6, selection: {} });
  let badErr = null;
  try { const d3 = render({ model: m3, el }); await settle(); out.badHud = (el.querySelector('.cdhud') || {}).textContent; d3(); }
  catch (e) { badErr = e.message; }
  out.badErr = badErr;

  // ── STREAMED (cd.open): header-only payload renders empty, then the replayed
  // chunk messages land PROGRESSIVELY into the same builder ──
  {
    const sPayload = new DataView(await (await fetch(`http://127.0.0.1:${port}/tmp/stream.bin`)).arrayBuffer());
    const sStyles = await (await fetch(`http://127.0.0.1:${port}/tmp/stream-styles.json`)).json();
    const sMsgs = await (await fetch(`http://127.0.0.1:${port}/tmp/stream-msgs.json`)).json();
    const sBufs = await (await fetch(`http://127.0.0.1:${port}/tmp/stream-bufs.bin`)).arrayBuffer();
    const m4 = makeModel({
      _payload: sPayload, _styles: sStyles, _fit: 0, section: null,
      background: '#121212', height: 460, edl: true, edl_strength: 1, budget: 3000000, selection: {},
    });
    const d4 = render({ model: m4, el });
    await settle();
    out.streamReady = m4._sent.find((m2) => m2 && m2.type === 'ready') || null;
    out.streamHeaderLit = lit().n;                         // nothing has arrived
    let off4 = 0;
    const msgs4 = sMsgs.map((m2) => ({
      content: m2.content,
      bufs: m2.lens.map((n2) => { const v = new DataView(sBufs, off4, n2); off4 += n2; return v; }),
    }));
    m4._deliver({ ...msgs4[0].content, epoch: 'WRONG' }, msgs4[0].bufs);   // a stale stream
    await settle();
    out.streamWrongLit = lit().n;
    const ep = (out.streamReady || {}).epoch;
    m4._deliver({ ...msgs4[0].content, epoch: ep }, msgs4[0].bufs);
    await settle();
    out.streamFirstLit = lit().n;                          // half the lattice renders already
    for (const m2 of msgs4.slice(1)) m4._deliver({ ...m2.content, epoch: ep }, m2.bufs);
    await settle(); await settle();
    out.streamLit = lit().n;
    out.streamHud = (el.querySelector('.cdhud') || {}).textContent;

    const host4 = el.querySelector('div');
    const cv4 = el.querySelector('canvas');
    const r4 = cv4.getBoundingClientRect();
    // pick → row + WORLD coords from the lazy lattice reconstruction (_posAt)
    let sel4 = {};
    for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45]]) {
      const cx2 = r4.left + r4.width * fx, cy2 = r4.top + r4.height * fy;
      cv4.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx2, clientY: cy2, bubbles: true }));
      cv4.dispatchEvent(new PointerEvent('pointerup', { clientX: cx2, clientY: cy2, bubbles: true }));
      await settle();
      sel4 = m4._get('selection') || {};
      if (sel4.row != null && sel4.row >= 0) break;
    }
    out.streamSel = sel4;
    out.streamPickText = (host4.querySelector('.cdpick') || {}).textContent || '';

    // select THROUGH sweeps the streamed rows (the _ijk lattice accessor)
    const tbtn4 = (p) => [...host4.querySelectorAll('.cdt button')].find((b2) => (b2.title || '').startsWith(p));
    tbtn4('Select through').click();
    tbtn4('Rectangle').click();
    host4.dispatchEvent(new PointerEvent('pointerdown', { clientX: r4.left + r4.width * 0.35, clientY: r4.top + r4.height * 0.35, bubbles: true }));
    host4.dispatchEvent(new PointerEvent('pointermove', { clientX: r4.left + r4.width * 0.65, clientY: r4.top + r4.height * 0.65, bubbles: true }));
    host4.dispatchEvent(new PointerEvent('pointerup', { clientX: r4.left + r4.width * 0.65, clientY: r4.top + r4.height * 0.65, bubbles: true }));
    await settle();
    out.streamThroughRows = totalOf(unpack(m4._get('_sel_rows')));

    // threshold carves the streamed layer (the resident value column)
    m4.set('_styles', sStyles.map((x2) => ({ ...x2, threshold: [15, 99] })));
    await settle();
    out.streamThrLit = lit().n;
    d4();
  }

  // ── streamed POINTS + streamed SUB-BLOCKED in one view ──
  {
    const sPayload = new DataView(await (await fetch(`http://127.0.0.1:${port}/tmp/stream2.bin`)).arrayBuffer());
    const sStyles = await (await fetch(`http://127.0.0.1:${port}/tmp/stream2-styles.json`)).json();
    const sMsgs = await (await fetch(`http://127.0.0.1:${port}/tmp/stream2-msgs.json`)).json();
    const sBufs = await (await fetch(`http://127.0.0.1:${port}/tmp/stream2-bufs.bin`)).arrayBuffer();
    const m7 = makeModel({
      _payload: sPayload, _styles: sStyles, _fit: 0, section: null,
      background: '#121212', height: 460, edl: true, edl_strength: 1, budget: 3000000, selection: {},
    });
    const d7 = render({ model: m7, el });
    await settle();
    const ep7 = (m7._sent.find((m2) => m2 && m2.type === 'ready') || {}).epoch;
    let off7 = 0;
    for (const m2 of sMsgs) {
      const bufs = m2.lens.map((n2) => { const v = new DataView(sBufs, off7, n2); off7 += n2; return v; });
      m7._deliver({ ...m2.content, epoch: ep7 }, bufs);
    }
    await settle(); await settle();
    out.s2Lit = lit().n;
    out.s2Hud = (el.querySelector('.cdhud') || {}).textContent;
    // through-select must sweep BOTH streamed accessors (f32 points + lattice)
    const host7 = el.querySelector('div');
    const r7 = el.querySelector('canvas').getBoundingClientRect();
    const tbtn7 = (p) => [...host7.querySelectorAll('.cdt button')].find((b2) => (b2.title || '').startsWith(p));
    tbtn7('Select through').click();
    tbtn7('Rectangle').click();
    host7.dispatchEvent(new PointerEvent('pointerdown', { clientX: r7.left + r7.width * 0.3, clientY: r7.top + r7.height * 0.3, bubbles: true }));
    host7.dispatchEvent(new PointerEvent('pointermove', { clientX: r7.left + r7.width * 0.7, clientY: r7.top + r7.height * 0.7, bubbles: true }));
    host7.dispatchEvent(new PointerEvent('pointerup', { clientX: r7.left + r7.width * 0.7, clientY: r7.top + r7.height * 0.7, bubbles: true }));
    await settle();
    const sel7 = unpack(m7._get('_sel_rows'));
    out.s2ThroughLayers = Object.keys(sel7).filter((k2) => sel7[k2].length).length;
    out.s2ThroughRows = totalOf(sel7);
    d7();
  }

  // ── via='files': the BROWSER reads the CSV itself over byte ranges ──
  {
    const fPayload = new DataView(await (await fetch(`http://127.0.0.1:${port}/tmp/files.bin`)).arrayBuffer());
    const fStyles = await (await fetch(`http://127.0.0.1:${port}/tmp/files-styles.json`)).json();
    out.filesPayloadBytes = fPayload.byteLength;           // header-only: the kernel sent NO data
    const m8 = makeModel({
      _payload: fPayload, _styles: fStyles, _file_info: {}, _fit: 0, section: null,
      background: '#121212', height: 460, edl: true, edl_strength: 1, budget: 3000000, selection: {},
    });
    const d8 = render({ model: m8, el });
    for (let k2 = 0; k2 < 20; k2++) { await settle(); if ((m8._get('_file_info') || {})[0]) break; }
    await settle();
    out.filesInfo = (m8._get('_file_info') || {})[0] || null;
    out.filesLit = lit().n;
    out.filesHud = (el.querySelector('.cdhud') || {}).textContent;
    // the ID buffer answers picks even with nothing resident
    const cv8 = el.querySelector('canvas');
    const r8 = cv8.getBoundingClientRect();
    let sel8 = {};
    for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45]]) {
      const cx2 = r8.left + r8.width * fx, cy2 = r8.top + r8.height * fy;
      cv8.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx2, clientY: cy2, bubbles: true }));
      cv8.dispatchEvent(new PointerEvent('pointerup', { clientX: cx2, clientY: cy2, bubbles: true }));
      await settle();
      sel8 = m8._get('selection') || {};
      if (sel8.row != null && sel8.row >= 0) break;
    }
    out.filesSel = sel8;
    d8();
  }

  // ── MESH context layer: scenery co-registered over a block model ──
  {
    const mPayload = new DataView(await (await fetch(`http://127.0.0.1:${port}/tmp/mesh.bin`)).arrayBuffer());
    const mStyles = await (await fetch(`http://127.0.0.1:${port}/tmp/mesh-styles.json`)).json();
    const m5 = makeModel({
      _payload: mPayload, _styles: mStyles, _fit: 0, section: null,
      background: '#121212', height: 460, edl: true, edl_strength: 1, budget: 3000000, selection: {},
    });
    const d5 = render({ model: m5, el });
    await settle(); await settle();
    const base5 = lit();
    out.meshLit = base5.n;
    out.meshSig = base5.sig;
    out.meshHud = (el.querySelector('.cdhud') || {}).textContent;
    // tint round-trips through the style (hex → setLayerMeshStyle)
    m5.set('_styles', mStyles.map((x2, k2) => (k2 === 1 ? { ...x2, color: '#ff3300' } : x2)));
    await settle();
    out.meshTintSig = lit().sig;
    // hiding the surface uncovers the model (fewer or different pixels, not a crash)
    m5.set('_styles', mStyles.map((x2, k2) => (k2 === 1 ? { ...x2, visible: false } : x2)));
    await settle();
    out.meshHidLit = lit().n;
    d5();
  }

  // ── batch A: value channels · category legend/eyes · draped surface · z-exag ──
  {
    const aPayload = new DataView(await (await fetch(`http://127.0.0.1:${port}/tmp/batcha.bin`)).arrayBuffer());
    const aStyles = await (await fetch(`http://127.0.0.1:${port}/tmp/batcha-styles.json`)).json();
    const m6 = makeModel({
      _payload: aPayload, _styles: aStyles, _fit: 0, section: null,
      background: '#121212', height: 460, edl: true, edl_strength: 1, budget: 3000000, selection: {},
    });
    const d6 = render({ model: m6, el });
    await settle(); await settle();
    const host6 = el.querySelector('div');
    const cv6 = el.querySelector('canvas');
    const r6 = cv6.getBoundingClientRect();
    const patch6 = (i2, p2) => m6.set('_styles', m6._get('_styles').map((x2, k2) => (k2 === i2 ? { ...x2, ...p2 } : x2)));
    const base6 = lit();
    out.aLit = base6.n; out.aSig = base6.sig;
    out.aHud = (el.querySelector('.cdhud') || {}).textContent;

    // channel switch: FE → SIO2 recolors with NO re-send, pick names the channel
    patch6(0, { value: 'SIO2' });
    await settle();
    out.chanSig = lit().sig;
    patch6(1, { visible: false });                         // the DEM covers the model from above — pick the BLOCKS
    await settle();
    let sel6 = {};
    for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45]]) {
      const cx2 = r6.left + r6.width * fx, cy2 = r6.top + r6.height * fy;
      cv6.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx2, clientY: cy2, bubbles: true }));
      cv6.dispatchEvent(new PointerEvent('pointerup', { clientX: cx2, clientY: cy2, bubbles: true }));
      await settle();
      sel6 = m6._get('selection') || {};
      if (sel6.row != null && sel6.row >= 0) break;
    }
    out.chanPickText = (host6.querySelector('.cdpick') || {}).textContent || '';
    patch6(0, { value: 'FE' });
    await settle();

    // category mode (surface still hidden, so the eyes' effect is visible):
    // the legend becomes a swatch list whose rows are EYES
    patch6(0, { color: 'category' });
    await settle();
    out.catRows = [...host6.querySelectorAll('.cdcat')].map((n2) => n2.textContent);
    out.catLit = lit().n;
    host6.querySelectorAll('.cdcat')[0].click();           // hide OX
    await settle();
    out.catHidLit = lit().n;
    out.catHidden = (m6._get('_styles')[0] || {}).categories_hidden;
    host6.querySelectorAll('.cdcat')[0].click();           // rows re-rendered — re-query, un-hide
    await settle();
    out.catRestoredLit = lit().n;
    patch6(0, { color: 'value' });
    patch6(1, { visible: true });
    await settle();
    out.chanBackSig = lit().sig;

    // the surface recolors on a ramp change (vertex colors rebake)
    out.surfSig = lit().sig;
    patch6(1, { ramp: 'fire' });
    await settle();
    out.surfRampSig = lit().sig;

    // vertical exaggeration stretches the DISPLAY
    m6.set('z_exaggeration', 4);
    await settle();
    out.zexLit = lit().n;
    m6.set('z_exaggeration', 1);
    await settle();
    d6();
  }
  return out;
}, PORT);

if (r.err) { console.log('FAIL:', r.err); process.exit(1); }

chk(`three kinds render co-registered in one view (${r.baseLit.toLocaleString()} lit px, hud "${r.hud}")`,
  r.baseLit > 20000 && /3 layers/.test(r.hud || ''));
chk(`per-layer visibility: hiding the model drops pixels (${r.baseLit.toLocaleString()} → ${r.hiddenLit.toLocaleString()}) and restores`,
  r.hiddenLit < r.baseLit * 0.9 && Math.abs(r.restoredLit - r.baseLit) < r.baseLit * 0.05);
chk(`per-layer threshold carves its own layer only (${r.thrLit.toLocaleString()} lit px)`,
  r.thrLit > 0 && r.thrLit < r.baseLit);
chk(`section cuts the scene (${r.baseLit.toLocaleString()} → ${r.sectionLit.toLocaleString()} px)`, r.sectionLit < r.baseLit * 0.95);
chk(`sectioned=False exempts a layer (exempt ${r.sectionLit.toLocaleString()} px > all-sectioned ${r.sectionAllLit.toLocaleString()} px)`,
  r.sectionAllLit < r.sectionLit);
chk(`pick returns layer + row (${JSON.stringify(r.selection)})`,
  r.selection && Number.isInteger(r.selection.row) && r.selection.row >= 0 && typeof r.selection.name === 'string' && r.selection.name.length > 0);
chk(`toolbar renders (${r.tbButtons} buttons) with the color legend`, r.tbButtons === 11 && r.legendShown);
chk(`rectangle select returns rows in the packed wire format (${r.rectTotal.toLocaleString()} rows over ${Object.keys(r.rectSel).length} layer(s))`,
  r.rectTotal > 0 && Object.keys(r.rectSel).length >= 1 && r.rectCursor === 'crosshair');
chk(`select THROUGH catches the volume behind the surface (${r.throughTotal.toLocaleString()} vs ${r.rectTotal.toLocaleString()} rows on the same box)`,
  r.throughOn === true && r.throughOff === false && r.throughTotal > r.rectTotal * 1.5);
chk(`the tube contains ${(r.subsetFrac * 100).toFixed(1)}% of the surface selection (edge elements differ: center vs pixels)`,
  r.subsetFrac > 0.9, `missed by layer: ${JSON.stringify(r.subsetMiss)} of ${r.subsetTotal}`);
chk(`lasso select is tighter than the box (${r.lassoTotal.toLocaleString()} vs ${r.rectTotal.toLocaleString()} rows)`,
  r.lassoTotal > 0 && r.lassoTotal < r.rectTotal);
chk('clear_selection() from Python empties it', r.clearedTotal === 0);
chk(`measure gives distance / bearing / plunge (${r.measurement.distance ? Math.round(r.measurement.distance) : '—'} m, brg ${r.measurement.bearing != null ? Math.round(r.measurement.bearing) : '—'}, plunge ${r.measurement.plunge != null ? Math.round(r.measurement.plunge) : '—'})`,
  !!r.measurement.distance && r.measurement.distance > 0 && Number.isFinite(r.measurement.bearing)
  && Number.isFinite(r.measurement.plunge) && Array.isArray(r.measurement.from) && r.measBandShown);
chk(`layers popover lists all 3 and a toggle reaches _styles (visible=${r.tbStylesVisible}, ${r.baseLit.toLocaleString()} → ${r.tbHidLit.toLocaleString()} px)`,
  r.popRows === 3 && r.tbStylesVisible === false && r.tbHidLit < r.baseLit * 0.9);
chk(`knife drag cuts a section on a free normal (${JSON.stringify(r.knifeSection && r.knifeSection.normal ? r.knifeSection.normal.map((v) => Math.round(v * 100) / 100) : null)})`,
  r.knifeSection && Array.isArray(r.knifeSection.normal) && Number.isFinite(r.knifeSection.position) && r.scrubShown);
chk(`knife shows a crosshair and a traced line that fills the view (${r.bandBox}px box, ${r.bandCaps} end caps)`,
  r.bandShown && r.bandBox > 600 && r.bandCaps === 2 && r.knifeCursor === 'crosshair', `cursor=${r.knifeCursor}`);
chk(`the scrub slider is pinned — it cannot move as the readout's number changes width (spread ${r.scrubSpread}px)`,
  r.scrubSpread === 0, JSON.stringify(r.scrubLabels));
chk(`a second view honours the widget's stored camera (ortho ${r.orthoBefore} -> ${r.orthoAfter})`,
  r.orthoBefore === false && r.orthoAfter === true);
chk(`pick readout shows the record incl. WORLD coords (${JSON.stringify((r.pickBoxText || '').slice(0, 42))})`,
  // the coords line comes from the wire-v3 _pos reconstruction — requiring it
  // here is what catches a dropped or layer-local position (slipped once)
  r.pickBoxShown && /row/.test(r.pickBoxText) && /x y z/.test(r.pickBoxText));
chk('dispose is clean and empties the host', !r.disposeErr && r.emptied, r.disposeErr || '');
chk(`a malformed payload degrades quietly (hud "${r.badHud}")`, !r.badErr && /no data/.test(r.badHud || ''), r.badErr || '');

// ── cd.open streaming ──
chk(`streamed view asks the kernel for rows (ready, epoch ${JSON.stringify((r.streamReady || {}).epoch)})`,
  r.streamReady && typeof r.streamReady.epoch === 'string' && r.streamReady.epoch.length > 0);
chk(`header-only payload renders empty, and a WRONG-epoch chunk is ignored (${r.streamHeaderLit} / ${r.streamWrongLit} lit px)`,
  r.streamHeaderLit < 500 && r.streamWrongLit < 500);
chk(`chunks render PROGRESSIVELY (first chunk ${r.streamFirstLit.toLocaleString()} px → full ${r.streamLit.toLocaleString()} px)`,
  r.streamFirstLit > 1000 && r.streamLit > r.streamFirstLit * 1.2);
chk(`eof completes the model (hud "${r.streamHud}")`,
  /4[,.]?000 blocks/.test(r.streamHud || ''));
chk(`pick on a streamed block gives the row + WORLD coords via the lattice (${JSON.stringify(r.streamSel)})`,
  Number.isInteger(r.streamSel.row) && r.streamSel.row >= 0 && /x y z/.test(r.streamPickText) && /category/.test(r.streamPickText));
chk(`select-through sweeps streamed rows (${r.streamThroughRows.toLocaleString()} rows)`, r.streamThroughRows > 100);
chk(`threshold carves the streamed layer's resident values (${r.streamLit.toLocaleString()} → ${r.streamThrLit.toLocaleString()} px)`,
  r.streamThrLit > 0 && r.streamThrLit < r.streamLit * 0.8);
chk(`streamed POINTS + SUB-BLOCKED render together (${meta.s2Points}+${meta.s2Blocks} rows, ${meta.s2Palette} sizes, hud "${r.s2Hud}")`,
  r.s2Lit > 10000 && /3[,.]?704 elements · 2 layers/.test(r.s2Hud || ''));
chk(`through-select sweeps BOTH streamed accessors (${r.s2ThroughRows.toLocaleString()} rows over ${r.s2ThroughLayers} layers)`,
  r.s2ThroughLayers === 2 && r.s2ThroughRows > 100);

// ── via='files': browser-side read over byte ranges, zero kernel bytes ──
chk(`via='files' ships a ${r.filesPayloadBytes}-byte payload and the BROWSER reads the file (${r.filesLit.toLocaleString()} px, hud "${r.filesHud}")`,
  r.filesPayloadBytes < 2048 && r.filesLit > 10000 && /576 blocks/.test(r.filesHud || ''));
chk(`discovery syncs back to the kernel (${JSON.stringify(r.filesInfo)})`,
  r.filesInfo && r.filesInfo.count === 576 && Array.isArray(r.filesInfo.value_range) && r.filesInfo.value_range[1] > 8);
chk(`pick works on a files-mode layer via the ID buffer (${JSON.stringify(r.filesSel)})`,
  Number.isInteger(r.filesSel.row) && r.filesSel.row >= 0);

// ── cd.mesh context layer ──
chk(`a mesh renders co-registered over the model (${meta.meshTris} tris, ${r.meshLit.toLocaleString()} lit px, hud "${r.meshHud}")`,
  r.meshLit > 20000 && /2 layers/.test(r.meshHud || ''));
chk(`mesh tint round-trips through color (sig ${r.meshSig} → ${r.meshTintSig})`, r.meshTintSig !== r.meshSig);
chk(`hiding the mesh changes the scene without a crash (${r.meshLit.toLocaleString()} → ${r.meshHidLit.toLocaleString()} px)`,
  r.meshHidLit > 0 && Math.abs(r.meshHidLit - r.meshLit) > r.meshLit * 0.02);

// ── batch A: channels · categories · surface · exaggeration ──
chk(`multi-channel model + draped surface render (${meta.mcChannels.join('/')}, ${r.aLit.toLocaleString()} px, hud "${r.aHud}")`,
  r.aLit > 20000 && /2 layers/.test(r.aHud || '') && meta.mcChannels.length === 2);
chk(`value-channel switch recolors client-side and switches back (sig ${r.aSig} → ${r.chanSig} → ${r.chanBackSig})`,
  r.chanSig !== r.aSig && r.chanBackSig !== r.chanSig);
chk(`the pick readout names the ACTIVE channel (${JSON.stringify((r.chanPickText || '').slice(0, 40))})`,
  /SIO2/.test(r.chanPickText));
chk(`category legend lists the classes as clickable eyes (${JSON.stringify(r.catRows)})`,
  r.catRows.length === 2 && r.catRows.join() === meta.mcCats.join());
chk(`clicking a swatch hides that class and round-trips (hidden ${JSON.stringify(r.catHidden)}, ${r.catLit.toLocaleString()} → ${r.catHidLit.toLocaleString()} → ${r.catRestoredLit.toLocaleString()} px)`,
  r.catHidLit < r.catLit * 0.95 && JSON.stringify(r.catHidden) === '["OX"]' && Math.abs(r.catRestoredLit - r.catLit) < r.catLit * 0.05);
chk(`the surface recolors on a ramp change (sig ${r.surfSig} → ${r.surfRampSig})`, r.surfRampSig !== r.surfSig);
chk(`vertical exaggeration stretches the display (${r.aLit.toLocaleString()} → ${r.zexLit.toLocaleString()} px at 4×)`,
  Math.abs(r.zexLit - r.aLit) > r.aLit * 0.02);

// ── figure chrome + hole labels (the composited overlay) ──
chk(`figure chrome draws (scale bar + north arrow: ${r.decoBase} ink px) and decorations=False clears it (${r.decoOff})`,
  r.decoBase > 100 && r.decoOff < r.decoBase * 0.2);
chk(`labels=True writes the BHIDs at the collars (+${r.decoLabels - r.decoBase} ink px)`,
  r.decoLabels > r.decoBase + 150);

console.log(fails ? `\nCONDENSER WIDGET: ${fails} FAILURES` : '\nCONDENSER WIDGET: PASS');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
