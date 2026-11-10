// micro — how a layer is COLOURED: the colour mode a choice resolves to, the choices a
// layer offers, the per-record value texture that lets a derived column colour a layer
// without rebuilding it, and the range and palette setters. The renderer draws; the
// props panel and the menus ask here.
import { html, setHTML, trusted } from './html.js';
import { RAMP_KIND, RAMP_PRESETS, addPaintColorOptions, applyRamp, colorSelOf, rampCfgOf, rampRangeFor, refreshProps, setRampCfg, syncRuleMode, useAsCategory } from './props.js';
import { buildValueTexture } from './valuetex.js';
import { quoteIdent } from '../../../ext/expr/index.js';
import { rowsProgress } from './analysis-ui.js';
import { S, activeLayer, layerById, requestRender } from './state.js';
import { reopenBlockChan, reopenDhChan } from './open.js';
import { markProjectDirty } from './project.js';
import { followLayer } from './tree.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setColorHooks): setActiveLayer
let H = {};
export function setColorHooks(h) { H = h; }

// Color-by adapts to the document: for a block model the select lists EVERY
// numeric column (switching re-streams sweep 2 with the new channel), plus the
// category column, elevation, and solid.
export function resolveColorMode() {
  const v = $('#colorBy').value;
  if (v === 'elev') return 0;
  if (v.startsWith('chan:')) return 1;
  if (v === 'cat' || v === 'rules' || v.startsWith('paint:')) return 2;   // rules/paint color through the palette (codes substitute)
  if (v === 'solid') return 3;
  return +v || 0;                                          // LAS numeric values
}

export function setColorLabels(header) {
  const sel = $('#colorBy');
  const blocks = header && (header.kind === 'blockmodel' || header.kind === 'drillholes');
  if (!blocks) {
    setHTML(sel, trusted('<option value="0">elevation</option><option value="1">intensity</option><option value="2">classification</option><option value="3">rgb</option>'));
    sel.value = '0';
    return;
  }
  setHTML(sel, html`<option value="elev">elevation</option>${(header.numericColumns || []).map((c) => html`<option value="chan:${c.i}">${c.name}</option>`)}${header.categories ? html`<option value="cat">${header.columns[header.mapping.cat]}</option>` : ''}<option value="rules">rule-based</option><option value="solid">solid</option>`);
  sel.value = header.mapping.chan != null ? `chan:${header.mapping.chan}` : 'elev';
}

// ── colour by a column the chunks don't carry: the per-record VALUE TEXTURE ──
// The chunks keep the channel they were built with (header.mapping.chan); any
// other numeric column draws from an R32F texture, one texel per record, that the
// renderer reads instead of the chunk attribute (setLayerChanTex). One texture per
// layer is kept (4 bytes a record of GPU memory), so going back to a column seen
// last is instant. Everything that colours a layer funnels through ensureValueTex:
// the dropdown, the host, project restore, and applyRamp after any re-read — so a
// re-read (a new document) can never keep drawing the old document's values.
export const valueTexEligible = (L) => { const bd = L && L.docs && L.docs.blockDoc; return !!(bd && bd.grid && !bd.forcePoints && !window.__noValueTex); };

export function valueTexWant(L, sel) {                            // the column the texture must hold, or null (the chunks' own)
  sel = String(sel || ''); if (!sel.startsWith('chan:')) return null;
  const bd = L.docs && L.docs.blockDoc; if (!bd) return null;
  const ch = +sel.slice(5); if (ch === bd.header.mapping.chan) return null;
  return bd.header.columns[ch] ?? null;
}

export const valueTexKey = (L, name) => name + '|' + JSON.stringify((L.qualify && L.qualify[name]) || null);

export function dropValueTex(L) {
  if (L._valTexBusy) { L._valTexBusy.ac.abort(); L._valTexBusy = null; }
  if (!L._valTex) return;
  S.renderer.setLayerChanTex(L.id, null); S.renderer.gl.deleteTexture(L._valTex.tex); L._valTex = null;
}

// → true (coloured from the texture, or none needed), false (superseded), null
// (a texture can't do it — the caller re-streams)
export function ensureValueTex(L, sel = colorSelOf(L)) {
  const bd = L.docs && L.docs.blockDoc;
  if (L._valTex && (!bd || L._valTex.hdr !== bd.header)) dropValueTex(L);   // a re-read: those values were the old document's
  const name = valueTexWant(L, sel);
  if (!name) { if (L._valTex) { S.renderer.setLayerChanTex(L.id, null); requestRender(); } return Promise.resolve(true); }
  if (!valueTexEligible(L)) return Promise.resolve(null);
  const key = valueTexKey(L, name);
  if (L._valTex && L._valTex.key === key) { S.renderer.setLayerChanTex(L.id, L._valTex.tex, L._valTex.range); requestRender(); return Promise.resolve(true); }
  if (L._valTexBusy && L._valTexBusy.key === key) return L._valTexBusy.p;
  if (L._valTexBusy) L._valTexBusy.ac.abort();             // a newer colour supersedes the one being read
  const ac = new AbortController(), t0 = performance.now();
  const p = (async () => {
    let r;
    try {
      r = await buildValueTexture(L, S.renderer.gl, quoteIdent(name), { signal: ac.signal,
        onProgress: (dn, N, w) => { if (!ac.signal.aborted && N) $('#meta').textContent = `colour by ${name}: ${rowsProgress(dn, N)} · ${w}`; } });
    } catch (e) { if (e && e.name === 'AbortError') return false; throw e; }
    finally { if (L._valTexBusy && L._valTexBusy.ac === ac) L._valTexBusy = null; }
    if (!r) return null;
    if (ac.signal.aborted || !layerById(L.id) || L.docs.blockDoc !== bd || valueTexWant(L, colorSelOf(L)) !== name) { S.renderer.gl.deleteTexture(r.tex); return false; }
    if (L._valTex) { S.renderer.gl.deleteTexture(L._valTex.tex); L._valTex = null; }
    L._valTex = { key, hdr: bd.header, tex: r.tex, range: r.range, name, where: r.where };
    S.renderer.setLayerChanTex(L.id, r.tex, r.range);
    applyRamp(L, true); requestRender();
    $('#meta').textContent = `coloured by ${name} — ${r.finite.toLocaleString()} values in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${r.where}`;
    return true;
  })();
  L._valTexBusy = { key, ac, p };
  return p;
}

// ── colour-by: ONE function for the dropdown and the host (window.micro). It
// used to live in the dropdown's change handler, so it only ever acted on the
// ACTIVE layer, and setLayerColorSel (its non-active stand-in) skipped the
// re-read a channel the open didn't load needs, quietly drawing the old one.
// A drillhole re-read REPLACES the layer (a new id — see layerReplaced), so this
// resolves to the id of the layer that now carries the colour.
//   v: 'elev' | 'solid' | 'rules' | 'cat' | 'chan:i' | 'catcol:NAME' | 'paint:…' | 'calc:…' | '0'–'3' (LAS/PLY)
export async function setLayerColorBy(L, v) {
  if (!L) return null;
  v = String(v);
  if (v.startsWith('catcol:')) {                           // another text column becomes THE category (a re-read)
    const name = v.slice(7), h = colorHeaderOf(L), i = h ? h.columns.indexOf(name) : -1;
    if (i < 0) throw new Error(`no column “${name}” on “${L.label || L.name}”`);
    if (!(h.categories && h.mapping.cat === i)) {
      L.colorSel = 'cat';
      await useAsCategory(L, i);
      L = layerById(followLayer(L.id)) || L;
    }
    v = 'cat';
  }
  L.colorSel = v;
  const d = L.docs || {};
  let reread = false;
  if (v.startsWith('chan:')) {
    const ch = +v.slice(5);
    if (d.dhDoc && ch !== d.dhDoc.header.mapping.chan) { await reopenDhChan(ch, L); L = layerById(followLayer(L.id)) || L; reread = true; }
    // Three sources, not two. This dispatch predated Parquet and sent it down the
    // delimited branch, where openBlocksBlob sniffed the Parquet bytes as text,
    // found no rows, and replaced a good document with an empty one — the layer
    // kept its count and its columns and drew nothing. Parquet re-opens through
    // its own provider, and takes the new channel as a mapping patch because it
    // resolves columns by mapping rather than by an opts.chan index.
    // A column the chunks weren't built with: read ONLY that column into a value
    // texture (src/valuetex.js) — the re-stream rebuilt every chunk to change one
    // number per block (17–19 s at 60M). The re-stream stays for what a texture
    // can't draw (a points view) or hold (more records than the GPU's texture size).
    else if (d.blockDoc && ch !== d.blockDoc.header.mapping.chan) {
      if (L.id === S.activeId && [...$('#colorBy').options].some((o) => o.value === v)) $('#colorBy').value = v;
      const ok = valueTexEligible(L) ? await ensureValueTex(L, v) : null;
      if (ok === null) { await reopenBlockChan(d.blockDoc, ch, { layer: L.id }); reread = true; }
    }
  }
  L.colorSel = v;                                          // (re)asserted on the successor
  // a re-read rewrites the dropdown from THAT layer's header — hand it back to the active one
  if (reread && L.id !== S.activeId && activeLayer()) H.setActiveLayer(S.activeId);
  if (L.id === S.activeId) {
    addPaintColorOptions(L);
    const cb = $('#colorBy');
    if ([...cb.options].some((o) => o.value === v)) cb.value = v;
  }
  applyRamp(L, true); syncRuleMode(L);
  dispatchEvent(new Event('micro:project-dirty'));
  requestRender();
  return L.id;
}

export const colorHeaderOf = (L) => { const d = (L && L.docs) || {}; return d.blockDoc ? d.blockDoc.header : d.dhDoc ? d.dhDoc.header : null; };

export const POINT_MODES = { elevation: '0', elev: '0', intensity: '1', classification: '2', rgb: '3' };

// what a layer can be coloured by, as a host names it (column names + mode words)
export function colorChoices(L) {
  const h = colorHeaderOf(L);
  if (!h) return L && (L.docs.lasDoc || L.docs.plyDoc) ? ['elevation', 'intensity', 'classification', 'rgb'] : [];
  const out = ['elev', ...(h.numericColumns || []).map((c) => c.name)];
  if (h.categories) out.push(h.columns[h.mapping.cat]);
  for (const c of L.catChoices || []) if (!out.includes(c)) out.push(c);
  for (const p of L.paintCols || []) out.push(p.name);
  for (const c of L.calcCols || []) if (c.ty !== 'string') out.push(c.name);
  out.push('rules', 'solid');
  return out;
}

// the inverse: what a layer is coloured by, as a host names it
export function colorByName(L) {
  const v = String(L.colorSel != null ? L.colorSel : L.id === S.activeId ? $('#colorBy').value : '');
  const h = colorHeaderOf(L);
  if (!h) return ['elevation', 'intensity', 'classification', 'rgb'][+v] || null;
  if (v === 'elev' || v === 'solid' || v === 'rules') return v;
  if (v.startsWith('chan:')) return h.columns[+v.slice(5)] ?? null;
  if (v === 'cat') return h.categories ? h.columns[h.mapping.cat] : null;
  if (v.startsWith('paint:') || v.startsWith('calc:')) return v.slice(v.indexOf(':') + 1);
  return v || null;
}

// a column NAME (or a mode word) → the colour-by selection value for that layer
export function colorSelFor(L, col) {
  const c = String(col), h = colorHeaderOf(L);
  if (!h) { if (POINT_MODES[c] != null && (L.docs.lasDoc || L.docs.plyDoc)) return POINT_MODES[c]; }
  else {
    if (c === 'elev' || c === 'elevation') return 'elev';
    if (c === 'solid' || c === 'rules') return c;
    const i = h.columns.indexOf(c);
    if (i >= 0) {
      if ((h.numericColumns || []).some((n) => n.i === i)) return 'chan:' + i;
      if (h.categories && h.mapping.cat === i) return 'cat';
      return 'catcol:' + c;                                // another text column: becomes THE category
    }
    if ((L.paintCols || []).some((p) => p.name === c)) return 'paint:' + c;
    if ((L.calcCols || []).some((p) => p.name === c && p.ty !== 'string')) return 'calc:' + c;
  }
  const ch = colorChoices(L);
  throw new Error(`color: “${c}” is not something “${L.label || L.name}” can be coloured by${ch.length ? ` (${ch.join(', ')})` : ''}`);
}

// ── colour RANGE and PALETTE, for the host (window.micro) and addLayer. Both act
// on what the styling panel acts on: the range is the layer's clip (the min/max
// boxes — the shader clamps outside it to the end colours), the palette is the
// preset of the CURRENT colour-by's ramp (each colour-by keeps its own).
// Only a numeric colour-by has either.
export function numericColorSel(L) {
  const sel = String(colorSelOf(L));
  if (sel === 'elev' || sel.startsWith('chan:')) return true;
  if (sel === '0') return !!(L.docs.lasDoc || L.docs.plyDoc);   // LAS/PLY elevation
  if (sel.startsWith('paint:')) { const pc = (L.paintCols || []).find((c) => c.name === sel.slice(6)); return !!(pc && (pc.kind === 'ratio' || pc.mat)); }
  if (sel.startsWith('calc:')) return (L.calcCols || []).some((c) => c.name === sel.slice(5) && c.ty !== 'string');
  return false;
}

export const notNumeric = (L, what) => new Error(`${what}: “${L.label || L.name}” is coloured by ${colorByName(L) ?? 'nothing'}, which has no numeric range`);

// the range in use → { min, max, fixed } (fixed = the host or the user set it), or null
export function layerColorRange(L) {
  if (!numericColorSel(L)) return null;
  const [min, max] = rampRangeFor(L);
  const fixed = Number.isFinite(parseFloat(L.clip[0])) || Number.isFinite(parseFloat(L.clip[1]));
  return { min, max, fixed };
}

export function setLayerColorRange(L, r) {
  if (!numericColorSel(L)) throw notNumeric(L, 'setColorRange');
  if (r == null) L.clip = ['', ''];
  else {
    const lo = +(r && r.min), hi = +(r && r.max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) throw new Error(`setColorRange: needs { min, max }, finite, min < max (got ${JSON.stringify(r)})`);
    L.clip = [String(lo), String(hi)];                   // String(number) round-trips a double exactly
  }
  if (L.id === S.activeId) { $('#clipMin').value = L.clip[0]; $('#clipMax').value = L.clip[1]; }   // the active layer draws from the boxes
  applyRamp(L, true);                                      // a custom ramp (or a ratio palette) bakes the range in
  refreshProps();
  markProjectDirty();
  requestRender();
}

export function layerPalette(L) { return numericColorSel(L) ? ((rampCfgOf(L) || {}).preset || 'viridis') : null; }

export function setLayerPalette(L, name) {
  const n = String(name);
  if (!RAMP_PRESETS[n]) throw new Error(`setPalette: no palette “${n}” (${Object.keys(RAMP_PRESETS).join(', ')})`);
  if (!numericColorSel(L)) throw notNumeric(L, 'setPalette');
  setRampCfg(L, { preset: n });
  applyRamp(L, true);                                      // now, not when the layer's stage settles
  refreshProps();
  requestRender();
}

export const paletteList = () => Object.keys(RAMP_PRESETS).map((name) => ({ name, kind: RAMP_KIND[name] || 'sequential' }));
