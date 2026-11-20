// The condenser view's plain-JS store (ext/condenser/view/src/store.js): the same contract
// anywidget's model gives the view in Jupyter. The view relies on two Backbone rules — set
// fires change:<key> synchronously, and an equal value fires nothing — so they are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../ext/condenser/view/src/store.js';

test('get / set / change:<key>, synchronously', () => {
  const s = createStore({ height: 460 });
  assert.equal(s.get('height'), 460);
  const seen = [];
  s.on('change:height', () => seen.push(s.get('height')));
  s.set('height', 520);
  assert.deepEqual(seen, [520], 'the handler ran inside set()');
  s.set('other', 1);
  assert.deepEqual(seen, [520], 'only its own key');
});

test('an equal value fires nothing — deep for plain data, identity for buffers', () => {
  const s = createStore({ _styles: [{ color: 'value', clip: [0, 1] }] });
  let n = 0;
  s.on('change:_styles', () => n++);
  s.set('_styles', [{ color: 'value', clip: [0, 1] }]);        // a fresh but equal array
  assert.equal(n, 0, 'no echo from an equal write-back');
  s.set('_styles', [{ color: 'value', clip: [0, 2] }]);
  assert.equal(n, 1);
  let p = 0;
  s.on('change:_payload', () => p++);
  const a = new DataView(new ArrayBuffer(8)), b = new DataView(new ArrayBuffer(8));
  s.set('_payload', a); s.set('_payload', a); s.set('_payload', b);
  assert.equal(p, 2, 'payloads compare by identity');
  let f = 0;
  s.on('change:sel', () => f++);
  s.set('sel', new Float64Array([1, 2])); s.set('sel', new Float64Array([1, 2])); s.set('sel', new Float64Array([1, 3]));
  assert.equal(f, 2, 'typed arrays by value');
});

test('off, save, send / emit, snapshot', () => {
  const s = createStore();
  let n = 0;
  const fn = () => n++;
  s.on('change:x', fn); s.set('x', 1); s.off('change:x', fn); s.set('x', 2);
  assert.equal(n, 1);
  let saved = 0; s.on('save', () => saved++); s.save_changes();
  assert.equal(saved, 1);
  const out = []; s.on('send', (c, b) => out.push([c, b.length]));
  s.send({ type: 'ready' });
  assert.deepEqual(out, [[{ type: 'ready' }, 0]]);
  const inn = []; s.on('msg:custom', (c, b) => inn.push([c.type, b.length]));
  s.emit({ type: 'chunk' }, [new ArrayBuffer(4)]);
  assert.deepEqual(inn, [['chunk', 1]]);
  assert.deepEqual(s.snapshot(), { x: 2 });
});

test('a handler that throws does not stop the others', () => {
  const s = createStore();
  const orig = console.error; console.error = () => {};
  let ran = false;
  s.on('change:k', () => { throw new Error('boom'); });
  s.on('change:k', () => { ran = true; });
  s.set('k', 1);
  console.error = orig;
  assert.ok(ran);
});
