// Format string parser: 'r--o' → { color, linestyle, marker }
//
// matplotlib's fmt is '[marker][line][color]' in ANY order ('o-', 'ro', '--r', 'k.' are all
// valid), and a format with a marker but no line style draws MARKERS ONLY: plot(x, y, 'o') is
// a scatter of dots, not a line through them. Both rules are what a model writing matplotlib
// from memory expects.

import { _warn } from './opts.js';

// plot's own softened single-letter colours (kept from 0.1: changing them would repaint every
// existing figure); colour NAMES like color='r' get matplotlib's exact ones (color.js)
const _colorChars = { b: '#4488ff', g: '#44bb44', r: '#ee4444', c: '#44dddd', m: '#dd44dd', y: '#dddd44', k: '#000000', w: '#ffffff' };
const _markerChars = new Set(['o', 's', '^', 'v', '<', '>', 'd', 'D', 'p', 'h', '*', '+', 'x', '.']);

export function parseFormat(fmt) {
  if (!fmt || typeof fmt !== 'string') return {};
  const result = {};
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (fmt.startsWith('--', i)) { result.linestyle = '--'; i += 2; continue; }
    if (fmt.startsWith('-.', i)) { result.linestyle = '-.'; i += 2; continue; }
    if (ch === '-' || ch === ':') { result.linestyle = ch; i++; continue; }
    // 'C0'…'C9': the default colour cycle by index
    if (ch === 'C' && /\d/.test(fmt[i + 1] || '')) { result.color = 'C' + fmt[i + 1]; i += 2; continue; }
    if (_markerChars.has(ch)) { result.marker = ch; i++; continue; }
    if (_colorChars[ch]) { result.color = _colorChars[ch]; i++; continue; }
    _warn('fmt.' + fmt, `plot(): format string '${fmt}' has '${ch}', which is not a colour, marker or line style; it was ignored`);
    i++;
  }
  if (result.marker && !result.linestyle) result.linestyle = 'None';
  return result;
}

export function dashArray(linestyle) {
  switch (linestyle) {
    case '--': case 'dashed': return [6, 4];
    case '-.': case 'dashdot': return [6, 2, 2, 2];
    case ':': case 'dotted': return [2, 3];
    default: return [];
  }
}

// no line at all: matplotlib's 'None' / 'none' / '' / ' '
export function _noLine(linestyle) {
  return linestyle === 'None' || linestyle === 'none' || linestyle === '' || linestyle === ' ';
}
