// @gcu/dispatch grammar — ontology from tool signatures (the adoptMcpTool bridge for the frame kind).
// Input: an MCP-style tool list (name, description, inputSchema with JSON-schema properties).
// Output: clause verb frames + noun types for enums, mergeable into a hand ontology.
// The only thing not in a signature is which preposition introduces which argument; that's a
// small role-name heuristic table, overridable per parameter with "x-preps".
import { cap } from '../text.js';

// preposition heuristic by role name (English canon). Locale banks translate from these.
const PREP_BY_ROLE = [
  [/^(domain|zone|region|area|in)$/, ['in', 'for']],
  [/^(source|from|input|data)$/, ['from', 'using']],
  [/^(target|into|output|destination)$/, ['into', 'to']],
  [/^(format|as)$/, ['as', 'to']],
  [/^(threshold|cap|cutoff|limit)$/, ['at', 'to', 'above']],
  [/^(length|size|interval)$/, ['to', 'at', 'by']],
  [/(radius|search|neighbou?rhood)$/, ['with', 'using']],
  [/^(variable|for|of)$/, ['for', 'to', 'on']],
  [/^(against|versus|vs)$/, ['with', 'to', 'against']],
];
const prepsFor = (name, schema) => schema['x-preps'] ?? (PREP_BY_ROLE.find(([re]) => re.test(name))?.[1] ?? ['with', 'using']);

// map a JSON-schema property to a clause type; may mint a noun type for enums
function typeOf(name, p, ont, units) {
  const s = p.type === 'array' ? p.items : p;
  if (s['x-type']) return [s['x-type']];                                   // refers to an existing noun type (variogram, blockmodel, …)
  if (s.enum && s.enum.every(v => ont.nouns.some(n => n.type === v))) return s.enum;   // enum of existing noun types = type union
  if (s.enum) {                                                            // enum → noun type named after the parameter, values = enum
    const type = s['x-noun'] ?? name;
    if (!ont.nouns.some(n => n.type === type)) ont.nouns.push({ type, words: Object.fromEntries(s.enum.map(v => [v, [String(v).toLowerCase()]])), '$from': 'enum' });
    return [type];
  }
  if (s.type === 'number' || s.type === 'integer') {
    const u = units.find(u => u.unit === s['x-unit']);
    const q = u ? `quantity:${u.dim}` : 'quantity:bare';
    const noun = ont.qmods?.find(m => m.head === name && (!u || m.dims.includes(u.dim)));   // "a 200 m search" is also a search
    return noun ? [name, q] : [q];
  }
  if (s.type === 'string') return ['*'];
  return ['*'];
}

export function framesFrom(tools, base) {
  const ont = structuredClone(base);
  const generated = [];
  for (const t of tools) {
    const props = t.inputSchema?.properties ?? {};
    const required = t.inputSchema?.required ?? [];
    const words = t['x-words'] ?? [t.name.split('_')[0]];
    const themeName = Object.keys(props).find(k => props[k]['x-theme']) ?? required[0] ?? Object.keys(props)[0];
    const frame = { name: t.name.split('_')[0], label: cap(t.name.split('_')[0]), words, theme: [], required: [], roles: {}, '$from': t.name };
    for (const [k, p] of Object.entries(props)) {
      const types = typeOf(k, p, ont, ont.units);
      if (k === themeName) { frame.theme = types; if (required.includes(k)) frame.required.push('theme'); if (p.type === 'array' && p['x-distributive']) frame.distributive = true; continue; }
      frame.roles[k] = { preps: prepsFor(k, p), types };
      if (required.includes(k)) frame.required.push(k);
    }
    if (t['x-creates']) frame.creates = true;
    if (t['x-min-theme']) frame.minTheme = t['x-min-theme'];
    if (t['x-sanity']) frame.sanity = t['x-sanity'];
    generated.push(frame);
  }
  // generated frames replace hand frames of the same verb, keeping hand locale columns (words_pt …); hand-only verbs are dropped (no tool)
  ont.verbs = generated.map(g => { const h = base.verbs.find(v => v.name === g.name); const loc = Object.fromEntries(Object.entries(h ?? {}).filter(([k]) => /_[a-z]{2}$/.test(k))); return { ...loc, ...g }; });
  return ont;
}
