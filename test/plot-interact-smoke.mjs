// @gcu/plot/interact in a real browser (spec §9 / §9a), driven by real mouse, wheel, keyboard
// and touch-like pointer events: hover without redrawing the figure, zoom about the cursor
// (log and inverted axes too), pan, reset, brush, click, keys, pinch, equal aspect kept, linked
// figures, a host's set_view, highlight, destroy. Also the svg / interact entry points as
// standalone ES modules. Run: node test/plot-interact-smoke.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0"></body>'); return; }
  const file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++; };
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/__blank`);

// a scatter (linear), a log-x / inverted-y line, an equal-aspect plan, and a second figure linked
await page.evaluate(async () => {
  const P = await import('/ext/plot/index.js');
  window.P = P;
  const [fig, ax] = P.subplots(1, 1, { figsize: [480, 340] });
  const n = 400, X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = (i % 20) * 5; Y[i] = Math.floor(i / 20) * 5; }
  ax.scatter(X, Y, { c: X, cmap: 'viridis', s: 16, label: 'grid' });
  ax.set_xlabel('E'); ax.set_ylabel('N'); ax.set_title('pts');
  let draws = 0; const d0 = fig.draw.bind(fig); fig.draw = (...a) => { draws++; return d0(...a); };
  window.T = { fig, ax, X, Y, draws: () => draws, events: { brush: [], click: [], view: [], hover: 0 } };
  const ui = P.interact(fig, { units: 'm', onBrush: (b) => T.events.brush.push(b), onClick: (c) => T.events.click.push(c), onViewChange: (v) => T.events.view.push(v) });
  ui.on('hover', () => T.events.hover++);
  T.ui = ui;
  ui.element.style.cssText += ';position:absolute;left:0;top:0';
  document.body.append(ui.element);

  const [fig2, ax2] = P.subplots(1, 1, { figsize: [480, 300] });
  ax2.plot([1, 10, 100, 1000], [0, 50, 200, 500], 'o-');
  ax2.set_xscale('log'); ax2.invert_yaxis();
  T.fig2 = fig2; T.ax2 = ax2;
  T.ui2 = P.interact(fig2);
  T.ui2.element.style.cssText += ';position:absolute;left:0;top:360px';
  document.body.append(T.ui2.element);

  const [fig3, ax3] = P.subplots(1, 1, { figsize: [300, 300] });
  ax3.add_geometry({ type: 'Polygon', coordinates: [[[0, 0], [400, 0], [400, 100], [0, 100], [0, 0]]] }, { label: 'lease' });
  ax3.set_aspect('equal');
  T.fig3 = fig3; T.ax3 = ax3;
  T.ui3 = P.interact(fig3, { units: 'm' });
  T.ui3.element.style.cssText += ';position:absolute;left:520px;top:0';
  document.body.append(T.ui3.element);

  const [fig4, ax4] = P.subplots(1, 1, { figsize: [300, 200] });
  ax4.plot([0, 100], [0, 100]);
  T.fig4 = fig4; T.ax4 = ax4;
  T.ui4 = P.interact(fig4);
  T.ui4.element.style.cssText += ';position:absolute;left:520px;top:360px';
  document.body.append(T.ui4.element);
  T.unlink = P.link([ax, ax4], { x: true, y: false });
  T.uiOf = (a) => [T.ui, T.ui2, T.ui3, T.ui4].find((u) => u.figure.axes.includes(a));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const view = (k) => page.evaluate((k) => { const a = T[k]; return { x: a.get_xlim(), y: a.get_ylim(), v: { x: a.view.x, y: a.view.y, w: a.view.w, h: a.view.h } }; }, k);
// page coordinates: a figure's pixels plus where its canvas sits on the page
const toPx = (k, x, y) => page.evaluate(([k, x, y]) => { const a = T[k], r = T.uiOf(a).canvas.getBoundingClientRect(), [p, q] = a.toPixel(x, y); return [r.left + p, r.top + q]; }, [k, x, y]);
const toData = (k, px, py) => page.evaluate(([k, px, py]) => { const a = T[k], r = T.uiOf(a).canvas.getBoundingClientRect(); return a.toData(px - r.left, py - r.top); }, [k, px, py]);
const overlayInk = (u) => page.evaluate((u) => { const c = T[u].overlay, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) k++; return k; }, u);

// ── hover: the overlay draws, the figure doesn't ──
{
  const [px, py] = await toPx('ax', 45, 25);
  const before = await page.evaluate(() => T.draws());
  await page.mouse.move(px + 1, py + 1);
  await page.mouse.move(px, py);
  await frames();
  const after = await page.evaluate(() => T.draws());
  const ink = await overlayInk('ui');
  chk('hover draws the overlay (readout, crosshair, ring)', ink > 400, `${ink} px`);
  chk('a pointer move does not redraw the figure', after === before, `${before} → ${after}`);
  chk('hover events fire', (await page.evaluate(() => T.events.hover)) > 0);
  const aria = await page.evaluate(() => T.ui.canvas.getAttribute('aria-label'));
  chk('the canvas is focusable and labelled', /pts — interactive/.test(aria) && (await page.evaluate(() => T.ui.canvas.tabIndex)) === 0, aria);
}

// ── wheel zoom about the cursor: the point under it stays under it ──
{
  const [px, py] = await toPx('ax', 30, 40);
  const v0 = await view('ax');
  await page.mouse.move(px, py);
  await page.mouse.wheel(0, -240);
  await frames();
  const v1 = await view('ax');
  const [dx, dy] = await toData('ax', px, py);
  chk('wheel zooms in', v1.x[1] - v1.x[0] < (v0.x[1] - v0.x[0]) * 0.9, `${(v0.x[1] - v0.x[0]).toFixed(1)} → ${(v1.x[1] - v1.x[0]).toFixed(1)}`);
  chk('about the cursor', close(dx, 30, 0.02) && close(dy, 40, 0.02), `${dx.toFixed(2)}, ${dy.toFixed(2)}`);
  const ev = await page.evaluate(() => T.events.view.length);
  chk('onViewChange fires', ev >= 1);
  // shift: x only
  const yBefore = v1.y;
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, 200); await page.keyboard.up('Shift');
  await frames();
  const v2 = await view('ax');
  chk('shift-wheel zooms x only', close(v2.y[0], yBefore[0], 1e-9) && close(v2.y[1], yBefore[1], 1e-9) && v2.x[1] - v2.x[0] > v1.x[1] - v1.x[0]);
}

// ── log x and inverted y: zoom keeps the point, pan keeps the inversion ──
{
  const [px, py] = await toPx('ax2', 100, 200);
  await page.mouse.move(px, py);
  await page.mouse.wheel(0, -300);
  await frames();
  const [dx, dy] = await toData('ax2', px, py);
  const v = await view('ax2');
  chk('log axis: zoom about the cursor', close(dx, 100, 0.02) && close(dy, 200, 0.02), `${dx.toFixed(2)}, ${dy.toFixed(1)}`);
  chk('inverted y stays inverted after zoom', v.y[0] > v.y[1], JSON.stringify(v.y.map((q) => +q.toFixed(1))));
  const ratio0 = v.x[1] / v.x[0];
  await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + 60, py + 30, { steps: 4 }); await page.mouse.up();
  await frames();
  const w = await view('ax2');
  const [ex, ey] = await toData('ax2', px + 60, py + 30);
  chk('drag pans: the grabbed point follows the pointer (log x, inverted y)', close(ex, 100, 0.02) && close(ey, 200, 0.02), `${ex.toFixed(2)}, ${ey.toFixed(1)}`);
  chk('a log pan keeps the decade span', close(w.x[1] / w.x[0], ratio0, 1e-6) && w.y[0] > w.y[1]);
  await page.mouse.dblclick(px, py);
  await frames();
  const h = await view('ax2');
  const home = await page.evaluate(() => { const [f, a] = P.subplots(1, 1, { figsize: [480, 300] }); a.plot([1, 10, 100, 1000], [0, 50, 200, 500]); a.set_xscale('log'); a.invert_yaxis(); f.toDrawList(); return { x: a.get_xlim(), y: a.get_ylim() }; });
  chk('double-click resets', close(h.x[0], home.x[0], 1e-9) && close(h.x[1], home.x[1], 1e-9) && close(h.y[0], home.y[0], 1e-9), JSON.stringify(h.x));
}

// ── equal aspect survives zoom, even shift-zoom ──
{
  const [px, py] = await toPx('ax3', 200, 50);
  await page.mouse.move(px, py);
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, -300); await page.keyboard.up('Shift');
  await page.mouse.wheel(0, 120);
  await frames();
  const v = await view('ax3');
  const ux = (v.x[1] - v.x[0]) / v.v.w, uy = (v.y[1] - v.y[0]) / v.v.h;
  chk('equal aspect: one data unit per pixel both ways after zooming', close(ux, uy, 1e-6), `${ux.toFixed(4)} ${uy.toFixed(4)}`);
  await page.mouse.move(px, py + 5);
  await frames();
  const lines = await page.evaluate(() => T.ui3.overlay ? true : false);
  chk('the plan view has an overlay', lines);
}

// ── brush, click, keys ──
{
  await page.evaluate(() => T.ui.reset());
  await frames();
  const [a0, b0] = await toPx('ax', 10, 60), [a1, b1] = await toPx('ax', 50, 20);
  await page.mouse.move(a0, b0);
  await page.keyboard.down('Shift');
  await page.mouse.down(); await page.mouse.move(a1, b1, { steps: 5 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  const br = await page.evaluate(() => T.events.brush.at(-1));
  chk('shift-drag brushes: onBrush with the data ranges', br && close(br.x[0], 10, 0.03) && close(br.x[1], 50, 0.03) && close(br.y[0], 20, 0.03) && close(br.y[1], 60, 0.03), JSON.stringify(br && { x: br.x, y: br.y }));
  chk('the selection is kept', (await page.evaluate(() => !!T.ui.selection)));
  const [cx, cy] = await toPx('ax', 45, 25);
  await page.mouse.click(cx, cy);
  const after = await page.evaluate(() => ({ b: T.events.brush.at(-1), c: T.events.click.at(-1) }));
  chk('a click clears the brush', after.b === null && (await page.evaluate(() => T.ui.selection)) === null);
  chk('and reports the pick', after.c && after.c.index === (45 / 5) + 20 * (25 / 5), JSON.stringify(after.c && { i: after.c.index, x: after.c.x, y: after.c.y }));
  // keys: focus came with the click
  const k0 = await view('ax');
  await page.keyboard.press('ArrowRight'); await frames();
  const k1 = await view('ax');
  chk('ArrowRight pans right by a tenth', close(k1.x[0] - k0.x[0], (k0.x[1] - k0.x[0]) * 0.1, 1e-6));
  await page.keyboard.press('+'); await frames();
  const k2 = await view('ax');
  chk('+ zooms in', k2.x[1] - k2.x[0] < k1.x[1] - k1.x[0]);
  await page.keyboard.press('0'); await frames();
  const k3 = await view('ax');
  const home = await page.evaluate(() => { const [f, a] = P.subplots(1, 1, { figsize: [480, 340] }); a.scatter(T.X, T.Y); a.set_title('pts'); a.set_xlabel('E'); a.set_ylabel('N'); f.toDrawList(); return a.get_xlim(); });
  chk('0 resets', close(k3.x[0], home[0], 1e-9) && close(k3.x[1], home[1], 1e-9), `${k3.x} vs ${home}`);
  await page.evaluate(() => T.ui.setSelection({ axes: T.ax, x: [0, 10], y: null }));
  await page.keyboard.press('Escape');
  chk('Esc clears the selection', (await page.evaluate(() => T.ui.selection)) === null);
}

// ── linked figures; a host's set_view; highlight ──
{
  await page.evaluate(() => { T.events.view.length = 0; });
  const [px, py] = await toPx('ax', 50, 50);
  await page.mouse.move(px, py);
  await page.mouse.wheel(0, -200);
  await frames(); await frames();
  const a = await view('ax'), b = await view('ax4');
  chk('link: zooming one figure moves the linked axes in another', close(a.x[0], b.x[0], 1e-9) && close(a.x[1], b.x[1], 1e-9), `${a.x} / ${b.x}`);
  chk('link {y: false}: y is its own', !close(a.y[0], b.y[0], 1e-6));
  const viewsBefore = await page.evaluate(() => T.events.view.length);
  await page.evaluate(() => T.ax.set_view({ xlim: [0, 20], ylim: [0, 20] }));
  await frames();
  const s = await view('ax');
  chk("a host's set_view redraws the figure", close(s.x[0], 0, 1e-9) && close(s.x[1], 20, 1e-9));
  chk('and fires no onViewChange (no echo)', (await page.evaluate(() => T.events.view.length)) === viewsBefore);
  const d0 = await page.evaluate(() => T.draws());
  await page.evaluate(() => T.ax.highlight((i, x, y) => x < 10));
  await frames();
  chk('highlight redraws the figure by itself', (await page.evaluate(() => T.draws())) > d0);
  const px2 = await page.evaluate(() => {
    const c = T.ui.canvas, g = c.getContext('2d'), dpr = c.width / T.fig.width;
    const [a, b] = T.ax.toPixel(5, 5), [e, f] = T.ax.toPixel(15, 5);
    const at = (x, y) => Array.from(g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
    return { kept: at(a, b), dimmed: at(e, f) };
  });
  const lum = (p) => p[0] + p[1] + p[2];
  chk('the chosen points stay bright, the rest dim', lum(px2.kept) > lum(px2.dimmed) + 30, JSON.stringify(px2));
  await page.evaluate(() => T.ax.highlight(null));
  // a highlight big enough for the raster path (it crashed there once: no dpr in its rect)
  const big = await page.evaluate(async () => {
    const [f, a] = P.subplots(1, 1, { figsize: [300, 200] });
    const n = 60000, X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = (i * 7919) % 1000; Y[i] = (i * 104729) % 1000; }
    a.scatter(X, Y, { s: 2 });
    a.highlight((i, x) => x < 600);
    try { const c = f.show(); return { ok: c.width > 0 }; } catch (e) { return { ok: false, err: e.message }; }
  });
  chk('a large highlight (the raster path) draws', big.ok, JSON.stringify(big));
}

// ── themeFromCSS on a host's own tokens (the model eval: 91 of 121 charts stayed dark on a
// light page, because it read only --au-* names) ──
{
  const r = await page.evaluate(() => {
    const mk = (css, style) => { const d = document.createElement('div'); d.setAttribute('style', css + (style || '')); document.body.append(d); return d; };
    const out = {};
    // the eval host's names, light
    const a = mk('--bg-primary:#fafafa; --text-primary:#111111; --border:#cccccc; --series-1:#e41a1c; --series-2:#377eb8; --series-3:#4daf4a;');
    let t = P.themeFromCSS(a); out.host = { bg: t.background, fg: t.foreground, frame: t.frame, cycle: t.cycle.length, c0: t.cycle[0] };
    // dark tokens
    t = P.themeFromCSS(mk('--bg-primary:#101214; --text-primary:#eeeeee;')); out.dark = { bg: t.background, fg: t.foreground };
    // --au-* first
    t = P.themeFromCSS(mk('--au-surface:#ffffff; --bg-primary:#000000;')); out.au = t.background;
    // no tokens at all, a white page: the computed colours decide (walking up past transparent)
    const wrap = mk('background:#ffffff; color:#222222;'); const inner = document.createElement('div'); wrap.append(inner);
    t = P.themeFromCSS(inner); out.none = { bg: t.background, fg: t.foreground };
    // a map for other names, the rest still found
    t = P.themeFromCSS(mk('--page-bg:#f0f0e8; --text-primary:#333333;'), { background: '--page-bg' }); out.map = { bg: t.background, fg: t.foreground };
    // a token in a form theme can't read (oklch): the computed background decides light / dark
    t = P.themeFromCSS(mk('--bg-primary:oklch(98% 0 0); background:#fcfcfc;')); out.oklch = { bg: t.background, panel: t.panel };
    // a chart dressed by it is light
    const [f] = P.subplots(1, 1, { figsize: [200, 120], theme: P.themeFromCSS(a) });
    out.figFace = f.facecolor; out.axFace = f.axes[0].get_facecolor();
    return out;
  });
  const isLight = (c) => { const m = /#([0-9a-f]{6})/i.exec(c || ''); if (m) return parseInt(m[1].slice(0, 2), 16) > 180; const n = /rgb\D*(\d+)/.exec(c || ''); return n ? +n[1] > 180 : false; };
  chk("themeFromCSS reads a host's own token names (--bg-primary, --text-primary, --border, --series-N)", r.host.bg === '#fafafa' && r.host.fg === '#111111' && r.host.frame === '#cccccc' && r.host.cycle === 3 && r.host.c0 === '#e41a1c', JSON.stringify(r.host));
  chk('… dark tokens stay dark; --au-* tokens come first', r.dark.bg === '#101214' && r.au === '#ffffff', JSON.stringify({ d: r.dark, au: r.au }));
  chk('… with no tokens, the page\'s computed colours decide (a light page never gets a dark chart)', isLight(r.none.bg) && /34, 34, 34|#222/.test(r.none.fg), JSON.stringify(r.none));
  chk('… a map renames some keys and the rest are still found; an unreadable token falls back to the computed background', r.map.bg === '#f0f0e8' && r.map.fg === '#333333' && isLight(r.oklch.panel) && r.oklch.bg.startsWith('oklch'), JSON.stringify({ m: r.map, o: r.oklch }));
  chk("… and the chart it dresses sits on the page (a transparent figure, the plot area the host's background)", r.figFace === 'transparent' && r.axFace === '#fafafa', JSON.stringify({ f: r.figFace, a: r.axFace }));
}

// ── style.use('auto'): new figures follow the page (dark stays the default) ──
{
  const r = await page.evaluate(() => {
    const body = document.body, before = body.getAttribute('style') || '';
    const face = () => { const [f] = P.subplots(1, 1, { figsize: [200, 120] }); return f.axes[0].get_facecolor(); };
    const out = { dflt: face() };
    body.setAttribute('style', before + ';background:#ffffff;color:#222222;--bg-primary:#fbfbfb;');
    out.dfltOnLight = face();                                // the default is still dark
    P.style.use('auto');
    out.autoLight = face();
    body.setAttribute('style', before + ';background:#101214;color:#eeeeee;');
    out.autoDark = face();
    P.style.use('dark_background');
    body.setAttribute('style', before + ';background:#ffffff;color:#222222;');
    out.back = face();
    const [f] = P.subplots(1, 1, { figsize: [200, 120], theme: 'auto' });
    out.perFigure = f.axes[0].get_facecolor();
    body.setAttribute('style', before);
    return out;
  });
  const light = (c) => { const m = /#([0-9a-f]{6})/i.exec(c || ''); if (m) return parseInt(m[1].slice(0, 2), 16) > 180; const n = /rgb\D*(\d+)/.exec(c || ''); return n ? +n[1] > 180 : false; };
  chk("style.use('auto'): a light page gets light charts, a dark page dark ones; the default stays dark", !light(r.dflt) && !light(r.dfltOnLight) && r.autoLight === '#fbfbfb' && !light(r.autoDark), JSON.stringify(r));
  chk("… style.use('dark_background') goes back; theme: 'auto' does it for one figure", !light(r.back) && light(r.perFigure), JSON.stringify({ back: r.back, per: r.perFigure }));
}

// ── pinch (two pointers) ──
{
  await page.evaluate(() => T.ui.reset());
  await frames();
  const v0 = await view('ax');
  await page.evaluate(() => {
    const c = T.ui.canvas, r = c.getBoundingClientRect();
    const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerType: 'touch', isPrimary: id === 1, button: 0 }));
    ev('pointerdown', 1, 200, 170); ev('pointerdown', 2, 260, 170);
    for (let k = 1; k <= 5; k++) { ev('pointermove', 1, 200 - k * 10, 170); ev('pointermove', 2, 260 + k * 10, 170); }
    ev('pointerup', 1, 150, 170); ev('pointerup', 2, 310, 170);
  });
  await frames();
  const v1 = await view('ax');
  const ratio = (v1.x[1] - v1.x[0]) / (v0.x[1] - v0.x[0]);
  chk('pinch apart zooms in (60 px → 160 px: × 0.375)', close(ratio, 60 / 160, 0.02), ratio.toFixed(3));
}

// ── destroy, and the standalone entry points ──
{
  const r = await page.evaluate(async () => {
    const el = T.ui4.element, parent = el.parentNode;
    T.ui4.destroy();
    const back = T.ui4.canvas.parentNode === parent && !document.contains(T.ui4.overlay);
    const S = await import('/ext/plot/src/svg.js');
    const I = await import('/ext/plot/src/interact.js');
    const svg = S.toSVG(T.fig.toDrawList());
    return { back, svg: svg.startsWith('<svg'), entry: typeof I.interact === 'function' && typeof I.link === 'function', noDraw: T.fig4._requestDraw === undefined };
  });
  chk('destroy puts the canvas back and forgets the figure', r.back && r.noDraw);
  chk('the svg and interact entry points load on their own', r.svg && r.entry);
}

chk('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await page.screenshot({ path: path.join(root, 'experiments', 'plot-interact.png') }).catch(() => {});

// ── the gallery: every API.md example, dark and paper, under interact(), with no error and no
// warning (a warning would mean the docs show an option plot ignores) ──
{
  const g = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const gerrs = [], warns = [];
  g.on('pageerror', (e) => gerrs.push(String(e)));
  g.on('console', (m) => { if (m.type() === 'error') gerrs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  await g.goto(`http://127.0.0.1:${PORT}/ext/plot/gallery.html`);
  await g.waitForFunction(() => window.__galleryDone > 0, null, { timeout: 30000 });
  const r = await g.evaluate(() => ({
    n: window.__galleryDone,
    figs: document.querySelectorAll('figure').length,
    canvases: document.querySelectorAll('figure canvas:not([style*="pointer-events"])').length,
    errs: document.querySelectorAll('.err').length,
    inked: [...document.querySelectorAll('figure canvas:not([style*="pointer-events"])')].filter((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0;
      for (let i = 3; i < d.length; i += 64) if (d[i]) k++;
      return k > 50;
    }).length,
  }));
  chk('gallery: every API.md example draws, dark and paper', r.figs === 2 * r.n && r.canvases === 2 * r.n && r.inked === 2 * r.n && r.errs === 0, JSON.stringify(r));
  chk('gallery: no errors, no warnings', gerrs.length === 0 && warns.length === 0, [...gerrs, ...warns].slice(0, 4).join(' | '));
  await g.screenshot({ path: path.join(root, 'experiments', 'plot-gallery.png'), fullPage: true }).catch(() => {});
  await g.close();
}
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
