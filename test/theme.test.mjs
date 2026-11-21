// @gcu/theme — the shared theme vocabulary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_KEYS, THEMES, resolveTheme, themeFromCSS, parseColor, isLight } from '../ext/theme/index.js';

test('every theme has every key', () => {
  for (const [name, t] of Object.entries(THEMES)) for (const k of THEME_KEYS) assert.ok(t[k] != null, `${name}.${k}`);
});

test('resolveTheme: names, partials over a base, copies not shared', () => {
  assert.equal(resolveTheme().background, THEMES.dark.background);
  assert.equal(resolveTheme('paper').background, '#FFFFFF');
  const p = resolveTheme({ base: 'light', accent: '#c00' });
  assert.equal(p.accent, '#c00'); assert.equal(p.foreground, THEMES.light.foreground);
  // a light background with no base picks the light base
  assert.equal(resolveTheme({ background: '#fafafa' }).foreground, THEMES.light.foreground);
  const a = resolveTheme('dark'); a.cycle.push('#000');
  assert.equal(THEMES.dark.cycle.length, 10, 'resolveTheme hands out copies');
  const warned = [];
  assert.equal(resolveTheme('neon', (m) => warned.push(m)).background, THEMES.dark.background);
  resolveTheme({ acent: '#fff' }, (m) => warned.push(m));
  assert.equal(warned.length, 2); assert.match(warned[1], /no key 'acent'/);
});

test('themeFromCSS reads tokens and picks the base from the background', () => {
  const vars = { '--au-surface': '#fdfdfd', '--au-action': '#123456' };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (p) => vars[p] || '' });
  try {
    const t = themeFromCSS({});
    assert.equal(t.background, '#fdfdfd'); assert.equal(t.accent, '#123456');
    assert.equal(t.foreground, THEMES.light.foreground, 'unset keys from the light base');
  } finally { delete globalThis.getComputedStyle; }
});

test('parseColor and isLight', () => {
  assert.deepEqual(parseColor('#abc'), [170, 187, 204]);
  assert.deepEqual(parseColor('#15171A'), [21, 23, 26]);
  assert.deepEqual(parseColor('rgba(29, 32, 36, 0.88)'), [29, 32, 36]);
  assert.equal(parseColor('teal'), null);
  assert.ok(isLight(THEMES.light.background) && isLight(THEMES.paper.background) && !isLight(THEMES.dark.background));
});
