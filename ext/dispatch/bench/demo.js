// Demo fixtures for the grammar bench: the session every corpus and bench run starts from, and a
// numen-style tool manifest for the same toolkit (what frames-from.js derives frames from). Bench only.
import { DEMO_NOW } from '../src/grammar/engine.js';
const DAY = 86400000, NOW = DEMO_NOW;
export const DEMO_OBJECTS = [
  { type: 'domain', value: 'west', t: 0 }, { type: 'domain', value: 'east', t: 0 }, { type: 'domain', value: 'oxide', t: 0 }, { type: 'domain', value: 'sulfide', t: 0 },
  { type: 'variogram', name: 'v1', attrs: { variable: 'Cu', model: 'spherical' }, by: 'fit', t: NOW - 10 * DAY },
  { type: 'variogram', name: 'v2', attrs: { variable: 'Cu', model: 'exponential' }, by: 'fit', t: NOW - 1.5 * DAY },
  { type: 'variogram', name: 'v3', attrs: { variable: 'Ni', model: 'spherical' }, by: 'fit', t: NOW - 0.5 * DAY },
  { type: 'blockmodel', name: 'bm1', attrs: { run: 'r1' }, by: 'krige', t: NOW - 9 * DAY },
  { type: 'run', name: 'r1', attrs: { variable: 'Cu', method: 'OK', search: { type: 'quantity', n: 150, unit: 'm', dim: 'length' } }, by: 'krige', t: NOW - 9 * DAY },
  { type: 'run', name: 'r2', attrs: { variable: 'Cu', method: 'SK', search: { type: 'quantity', n: 300, unit: 'm', dim: 'length' } }, by: 'krige', t: NOW - 1.2 * DAY },
];

// ---- demo: a numen-style manifest for the same toolkit ----
export const DEMO_TOOLS = [
  { name: 'krige', description: 'Estimate a variable into a block model by kriging.', 'x-words': ['krige', 'estimate', 'interpolate'],
    'x-sanity': [{ role: 'variogram', attr: 'variable', against: 'theme' }],
    inputSchema: { type: 'object', required: ['variable'], properties: {
      variable: { type: 'array', items: { 'x-type': 'variable' }, 'x-theme': true, 'x-distributive': true },
      domain: { type: 'array', items: { 'x-type': 'domain' } },
      variogram: { 'x-type': 'variogram' },
      search: { type: 'number', 'x-unit': 'm', 'x-preps': ['with', 'using'] },
      method: { enum: ['OK', 'SK', 'IK', 'IDW', 'NN'] },
      source: { enum: ['samples', 'composites'] },
      target: { 'x-type': 'blockmodel' } } } },
  { name: 'fit_variogram', description: 'Fit a variogram model.', 'x-words': ['fit'], 'x-creates': true,
    inputSchema: { type: 'object', required: ['variogram'], properties: {
      variogram: { 'x-type': 'variogram', 'x-theme': true },
      variable: { 'x-type': 'variable' }, domain: { type: 'array', items: { 'x-type': 'domain' } },
      model: { enum: ['spherical', 'exponential', 'gaussian', 'nugget'], 'x-noun': 'vmodel' },
      source: { enum: ['samples', 'composites'] } } } },
  { name: 'clip', description: 'Top-cut a variable.', 'x-words': ['clip', 'cap', 'topcut'],
    inputSchema: { type: 'object', required: ['variable', 'threshold'], properties: {
      variable: { 'x-type': 'variable', 'x-theme': true }, threshold: { type: 'number', 'x-unit': '%' }, domain: { type: 'array', items: { 'x-type': 'domain' } } } } },
  { name: 'composite', description: 'Regularise samples to a length.', 'x-creates': true,
    inputSchema: { type: 'object', required: ['samples', 'length'], properties: {
      samples: { 'x-type': 'samples', 'x-theme': true }, length: { type: 'number', 'x-unit': 'm' }, domain: { type: 'array', items: { 'x-type': 'domain' } } } } },
  { name: 'export', 'x-words': ['export', 'save'],
    inputSchema: { type: 'object', required: ['thing'], properties: { thing: { type: 'string', 'x-theme': true }, format: { enum: ['csv', 'json', 'gslib', 'xlsx', 'dxf'] } } } },
  { name: 'show', 'x-words': ['show', 'display', 'list', 'open', 'plot'],
    inputSchema: { type: 'object', required: ['thing'], properties: { thing: { type: 'string', 'x-theme': true }, domain: { type: 'array', items: { 'x-type': 'domain' } } } } },
  { name: 'delete', 'x-words': ['delete', 'remove', 'drop'], inputSchema: { type: 'object', required: ['thing'], properties: { thing: { type: 'string', 'x-theme': true } } } },
  { name: 'compare', 'x-min-theme': 2, inputSchema: { type: 'object', required: ['things'], properties: { things: { type: 'array', items: { type: 'string' }, 'x-theme': true }, against: { type: 'string' } } } },
];
