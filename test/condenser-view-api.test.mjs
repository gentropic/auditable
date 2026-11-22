// The condenser view's JS API (ext/condenser/view/src/api.js) packs layers exactly as the
// Python gcu.condenser does — same header, same wire columns (dtype, length, contents) —
// so the view sees the same thing from either side. The reference is the real Python
// packers' output for fixed inputs (test/fixtures/condenser-view-parity.py, run in the
// package's venv). Plus the API's own contract: errors, warnings, streams. Node, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// the shipped bundle (the sources carry a build-time marker for the embedded parquet reader)
const API = await import('../ext/condenser/view/index.js');
const ref = JSON.parse(fs.readFileSync(new URL('./fixtures/condenser-view-parity.json', import.meta.url), 'utf8'));
const byName = Object.fromEntries(ref.cases.map((c) => [c.name, c]));
const nan = (a) => a.map((v) => (v === null ? NaN : v));

const DTYPE = { Float64Array: 'float64', Float32Array: 'float32', Uint32Array: 'uint32', Uint16Array: 'uint16', Uint8Array: 'uint8' };

function close(a, b, tol, what) {
  if (Array.isArray(a) || Array.isArray(b)) {
    assert.equal(a.length, b.length, `${what}: length`);
    a.forEach((v, i) => close(v, b[i], tol, `${what}[${i}]`));
    return;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);
    return;
  }
  assert.deepEqual(a, b, what);
}

function check(caseName, layer) {
  const c = byName[caseName];
  assert.equal(layer.kind, c.kind, `${caseName}: kind`);
  assert.deepEqual(Object.keys(layer.cols).sort(), Object.keys(c.cols).sort(), `${caseName}: the same wire columns`);
  for (const [k, want] of Object.entries(c.cols)) {
    const got = layer.cols[k];
    assert.equal(DTYPE[got.constructor.name], want.dtype, `${caseName}: ${k} dtype`);
    assert.equal(got.length, want.len, `${caseName}: ${k} length`);
    let sum = 0, wsum = 0;
    for (let i = 0; i < got.length; i++) if (got[i] === got[i]) { sum += got[i]; wsum += got[i] * ((i % 97) + 1); }
    // integer columns (codes, lattice indices, intensities) must match exactly; floats to f32 rounding
    const tol = /int/.test(want.dtype) ? 0 : 1e-6;
    close(sum, want.sum, tol, `${caseName}: ${k} sum`);
    close(wsum, want.wsum, tol, `${caseName}: ${k} position-weighted sum`);
    if (want.first !== null) close(got[0], want.first, 1e-6, `${caseName}: ${k}[0]`);
  }
  assert.deepEqual(Object.keys(layer.extra).sort(), Object.keys(c.extra).sort(), `${caseName}: the same header keys`);
  for (const [k, want] of Object.entries(c.extra)) close(layer.extra[k], want, 1e-9, `${caseName}: header ${k}`);
  assert.deepEqual(layer.categories, c.categories, `${caseName}: categories`);
  assert.equal(layer.style.color, c.style.color, `${caseName}: default color`);
  assert.equal(layer.style.value, c.style.value, `${caseName}: default value channel`);
}

test('blocks: lattice, u16 ijk, two value channels, category — as Python packs them', () => {
  const c = byName['blocks, two channels + category'];
  const t = { ...c.inputs, FE: nan(c.inputs.FE), SIO2: nan(c.inputs.SIO2) };
  check(c.name, API.blocks(t, { x: 'XC', y: 'YC', z: 'ZC', value: ['FE', 'SIO2'], category: 'ROCK', name: 'model' }));
});

test('blocks, sub-blocked: the fine lattice and the half-dim palette', () => {
  const c = byName['sub-blocked'];
  check(c.name, API.blocks(c.inputs, { value: 'AU', size: ['DX', 'DY', 'DZ'] }));
});

test('points: f32 about the bbox centre, u16 intensity, numeric categories in numpy order', () => {
  const c = byName['points, value + numeric category'];
  check(c.name, API.points({ ...c.inputs, CU: nan(c.inputs.CU) }, { value: 'CU', category: 'DOM' }));
});

test('drillholes: shared BHID codes, the three tables', () => {
  const c = byName.drillholes;
  check(c.name, API.drillholes(c.inputs.collar, c.inputs.survey, c.inputs.assay, { value: 'AU', category: 'LITH' }));
});

test('mesh and surface', () => {
  const m = byName.mesh;
  check(m.name, API.mesh(m.inputs.verts, m.inputs.tris, { opacity: 0.5 }));
  const s = byName['surface + drape'];
  check(s.name, API.surface(s.inputs.dem, { origin: [451200, 8205800], pitch: 12.5, drape: s.inputs.drape, nodata: -9999 }));
});

test('a columns object works without naming columns; typed arrays are used in place', () => {
  const x = new Float64Array([0, 10, 20]), y = new Float64Array([0, 0, 0]), z = new Float64Array([5, 5, 5]);
  const value = new Float32Array([1, 2, 3]);
  const b = API.blocks({ x, y, z, value });
  assert.equal(b.cols.value, value, 'an f32 value column is not copied');
  assert.equal(b.style.color, 'value');
  const arrow = { getChild: (n) => ({ x, y, z }[n] ? { toArray: () => ({ x, y, z })[n] } : null) };
  assert.equal(API.points(arrow).count, 3, 'an Arrow-like table');
});

test('errors say what came; unknown options warn with the real name', () => {
  assert.throws(() => API.blocks({ x: [0, 1], y: [0], z: [0, 0] }), /y has 1 values, expected 2/);
  assert.throws(() => API.blocks({ x: [0, 1.3, 2], y: [0, 0, 0], z: [0, 0, 0] }), /not on a regular lattice/);
  assert.throws(() => API.points({ x: [1], y: [1], z: [1] }, { value: 'AU' }), /no column "AU"/);
  const w = []; const orig = console.warn; console.warn = (m) => w.push(m);
  API.points({ x: [1], y: [1], z: [1] }, { colour: 'value', poinst_size: 3 });
  console.warn = orig;
  assert.match(w.join('\n'), /points\(\) has no option 'colour', did you mean 'color'\?/);
  assert.match(w.join('\n'), /did you mean 'point_size'\?/);
});

test('streams: a declared shape, append checks the lattice, the categories and the capacity', () => {
  const m = API.blocks.stream({ axes: [[0, 10, 4], [0, 10, 4], [0, 5, 2]], capacity: 5, value_range: [0, 1], categories: ['a', 'b'] }, { name: 'm' });
  assert.equal(m.extra.streamed, true);
  assert.equal(m.extra.pos, 'ijk');
  assert.deepEqual(m.extra.bbox, [-5, -5, -2.5, 35, 35, 7.5]);
  assert.equal(m.style.color, 'value');
  assert.throws(() => API.blocks.stream({ capacity: 3 }), /needs axes/);
  assert.throws(() => API.points.stream({ capacity: 3 }), /needs bbox/);
  assert.throws(() => API.points.stream({ bbox: [0, 0, 0, 1, 1, 1] }), /needs a capacity/);
});

test('value as a mapping or a list of columns, given in the columns object itself (the model eval C1)', () => {
  const x = [1, 2, 3], y = [1, 2, 3], z = [1, 2, 3], fe = [5, 6, 7], cu = [1, 1, 2];
  const a = API.points({ x, y, z, value: { Fe: fe, Cu: cu } });
  assert.equal(a.style.value, 'Fe');
  assert.deepEqual(Array.from(a.cols.value), fe); assert.deepEqual(Array.from(a.cols.value1), cu);
  const b = API.blocks({ x, y, z, value: { Fe: fe } });
  assert.equal(b.style.value, 'Fe');
  const c = API.points({ x, y, z, value: [fe, cu] });
  assert.deepEqual(Array.from(c.cols.value1), cu);
  assert.deepEqual(Array.from(API.points({ x, y, z, value: fe }).cols.value), fe);   // one plain column, as before
});
