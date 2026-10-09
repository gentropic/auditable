// plot without a DOM (spec_inbox/lang/plot-headless-spec.md): the plt module object exists in
// every host, figures shown with no DOM are recorded for plt.shown(), and a figure is plain
// JSON (toDrawList) that replay() draws on a real context. Node, no window, no document.
// The pixel comparison of replay vs draw is test/plot-replay-smoke.mjs (a browser).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../ext/plot/index.js');
const { run, registerModule, unregisterModule } = await import('../ext/adder/src/index.js');
const plt = P.pltAdder;

beforeEach(() => plt.close('all'));

async function py(code) {
  registerModule('plt', plt);
  try { return await run(code); } finally { unregisterModule('plt'); }
}

test('the module object exists without a window and adder can import it', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  await py('import plt\nplt.plot([1, 2, 3])\nplt.title("t")\nplt.show()');
  const figs = plt.shown();
  assert.equal(figs.length, 1, 'plot() shows and show() does not add the same figure twice');
  assert.ok(figs[0] instanceof P.Figure);
});

test('toDrawList is JSON, carries the title, and is the same every time', async () => {
  await py('import plt\nplt.plot([1, 2, 3])\nplt.title("t")\nplt.show()');
  const fig = plt.shown()[0];
  const a = fig.toDrawList();
  const b = fig.toDrawList();
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.deepEqual(a, b);
  assert.equal(a.width, fig.width);
  assert.ok(a.ops.some((o) => o[0] === 'fillText' && o[1] === 't'));
  assert.ok(a.ops.some((o) => o[0] === 'set' && o[1] === 'font'));
});

test('hist, bar, scatter, imshow and a 2×2 subplots each draw; imshow is one image op', async () => {
  const lists = {};
  const each = {
    hist: 'plt.hist([1, 2, 2, 3, 3, 3])',
    bar: 'plt.bar([1, 2, 3], [3, 1, 2])',
    scatter: 'plt.scatter([1, 2, 3], [3, 1, 2])',
    imshow: 'plt.imshow([1, 2, 3, 4, 5, 6], 3, 2)',
    grid: 'fig, axs = plt.subplots(2, 2)\naxs[0][0].plot([1, 2], [2, 1])\naxs[1][1].bar([1, 2], [2, 3])\nplt.show()',
  };
  for (const [k, code] of Object.entries(each)) {
    plt.close('all');
    await py(`import plt\n${code}`);
    const figs = plt.shown();
    assert.equal(figs.length, 1, k);
    lists[k] = figs[0].toDrawList();
    assert.ok(lists[k].ops.length > 10, `${k}: ${lists[k].ops.length} ops`);
  }
  const images = lists.imshow.ops.filter((o) => o[0] === 'image');
  assert.equal(images.length, 1);
  const [, x, y, w, h, cols, rows, b64] = images[0];
  assert.equal(cols, 3); assert.equal(rows, 2);
  assert.ok(w > 0 && h > 0 && Number.isFinite(x) && Number.isFinite(y));
  assert.equal(Buffer.from(b64, 'base64').length, cols * rows * 4);
  // a 20×20 raster stays one op: its 400 cells are not 400 fillRects
  plt.close('all');
  await py('import plt\nplt.imshow(list(range(400)), 20, 20)');
  const big = plt.shown()[0].toDrawList().ops;
  assert.equal(big.filter((o) => o[0] === 'image').length, 1);
  assert.ok(big.filter((o) => o[0] === 'fillRect').length < 50, 'imshow cells are not drawn as individual rects');
});

test('imshow rows: origin lower puts the last data row at the top of the image', async () => {
  await py('import plt\nplt.imshow([0.0, 0.0, 1.0, 1.0], 2, 2, cmap="gray")');
  const op = plt.shown()[0].toDrawList().ops.find((o) => o[0] === 'image');
  const px = Buffer.from(op[7], 'base64');
  assert.equal(px[0], 255, 'top-left pixel is data row 1 (value 1 → white)');
  assert.equal(px[8], 0, 'bottom-left pixel is data row 0 (value 0 → black)');
});

test('replay drives a context through the same ops, image included', () => {
  const fig = P.subplots().fig;
  fig.axes[0].plot([1, 2, 3], [2, 1, 3]);
  fig.axes[0].imshow([1, 2, 3, 4], 2, 2);
  const list = fig.toDrawList();
  const seen = [];
  const ctx = new Proxy({}, {
    get: (_, n) => (n === 'imageSmoothingEnabled' ? true : (...args) => seen.push([n, ...args])),
    set: (_, n, v) => { seen.push(['set', n, v]); return true; },
  });
  // image ops need a scratch canvas; a stub keeps this a Node test
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return { putImageData() {} }; } };
  globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  try { P.replay(ctx, list); } finally { delete globalThis.OffscreenCanvas; delete globalThis.ImageData; }
  assert.equal(seen.filter((o) => o[0] === 'drawImage').length, 1);
  assert.equal(seen.filter((o) => o[0] === 'lineTo').length, list.ops.filter((o) => o[0] === 'lineTo').length);
  assert.throws(() => P.replay(ctx, { ops: [['evil']] }), /unknown op/);
});

test('savefig with no DOM records { name, figure }; close and clf forget', async () => {
  await py('import plt\nfig, ax = plt.subplots()\nax.plot([1, 2])\nplt.savefig("a.png")');
  assert.deepEqual(plt.saved().map((s) => s.name), ['a.png']);
  assert.equal(plt.shown().length, 1);
  plt.close(plt.shown()[0]);
  assert.equal(plt.shown().length, 0);
  assert.equal(plt.saved().length, 0);
  await py('import plt\nplt.plot([1])\nplt.plot([2])');
  assert.equal(plt.shown().length, 2);
  await py('import plt\nplt.clf()');
  assert.equal(plt.shown().length, 0);
});

test('non-finite coordinates are dropped, as a canvas would', () => {
  const rec = P.recordingContext(10, 10);
  rec.moveTo(0, 0);
  rec.lineTo(NaN, 1);
  rec.lineTo(1, Infinity);
  rec.lineTo(2, 2);
  assert.deepEqual(rec.ops.map((o) => o[0]), ['moveTo', 'lineTo']);
  rec.font = '11px monospace';
  assert.equal(rec.measureText('abcd').width, 4 * 0.6 * 11);
  rec.save(); rec.font = '20px monospace'; rec.restore();
  assert.equal(rec.font, '11px monospace');
});
