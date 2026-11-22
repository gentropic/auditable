// ── a figure made again with OTHER DATA ("Use with other data…"). A figure names its data in
// many places: each 3D view's scene (layers, colour-by column, filter, camera), the facts it
// recorded, legends, the recipes behind charts and tables, resource tables, stereonets, and
// captions' statistics ({mean:layer:AU}). This module finds every such reference and rewrites
// them through one plan: { layers: {old → new name}, columns: {old layer → {old col → new col}},
// placement: 'move' | 'scale' }. Pure over the document — micro hands it the new layers' names,
// labels and world boxes; the composer then re-renders (↻ refresh). ──

const COL_KEYS = new Set(['col', 'cols', 'weight', 'x', 'y', 'groupBy', 'grade']);
const MODE_WORDS = new Set(['elev', 'elevation', 'intensity', 'classification', 'rgb', 'solid', 'rules']);
// the statistic fields' grammar (composer's STAT_RE): {fn:[layer:]col[:fmt][@id]}
const STAT_RE = /\{(mean|median|min|max|std|n):([^{}@]+?)((?::[,_]?(?:\.\d{1,2})?[f%e]?)?(?:@[\w.-]+)?)\}/g;

import { subjectFrame } from '../../../ext/compo/index.js';

const isView = (f) => !!(f.source && f.source.kind === 'view');
const factsOf = (f) => (isView(f) ? f.content && f.content.meta && f.content.meta.facts : f.source && f.source.facts) || null;

// a statistic that names no layer ({mean:AU}) is about its subject view (its @id, the caption's
// refers-to, else the nearest view) and was answered by the first shown layer there having the
// column — the view's facts record which. That layer is the one whose column it uses.
function statLayer(doc, text, key, tail) {
  const at = (/@([\w.-]+)$/.exec(tail || '') || [])[1] || null;
  const v = subjectFrame({ doc, at }, text, isView);
  if (!v || !isView(v) || !v.source.scene) return null;
  const shown = (v.source.scene.layers || []).filter((sl) => sl.visible);
  const fx = factsOf(v), got = fx && fx.stats && fx.stats[key];
  const by = got && got.layer && shown.find((sl) => sl.name === got.layer || sl.label === got.layer);
  return (by || shown[0] || {}).name || null;
}
function eachStat(md, fn) { STAT_RE.lastIndex = 0; let m; while ((m = STAT_RE.exec(String(md)))) fn(m); }

// walk a recipe's params: every layer it names, and the columns under each
function walkParams(p, top, visit) {
  const go = (o, layer) => {
    if (Array.isArray(o)) { for (const x of o) if (x && typeof x === 'object') go(x, layer); return; }
    if (!o || typeof o !== 'object') return;
    const here = typeof o.layer === 'string' ? o.layer : layer;
    if (typeof o.layer === 'string') visit.layer(o, here);
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (COL_KEYS.has(k) && typeof v === 'string' && v) visit.col(o, k, null, here);
      else if (COL_KEYS.has(k) && Array.isArray(v)) v.forEach((s, i) => { if (typeof s === 'string' && s) visit.col(v, i, null, here); });
      else if (k === 'density' && v && typeof v.col === 'string' && v.col) visit.col(v, 'col', null, here);
      else if (k === 'filter' && typeof v === 'string' && v) visit.filter(o, k, here);
      else if (v && typeof v === 'object' && k !== 'density') go(v, here);
    }
  };
  go(p, top);
}
const recipeTop = (p) => (p && (p.layer || (p.series && p.series[0] && p.series[0].layer))) || null;

// what a figure uses: [{ name, visible, cols: Set, filters: Set, where: Set, box }]
export function figureRefs(doc) {
  const by = new Map();
  const use = (name, where) => {
    if (!name) return null;
    let r = by.get(name);
    if (!r) by.set(name, (r = { name, visible: false, cols: new Set(), filters: new Set(), where: new Set(), box: null }));
    r.where.add(where); return r;
  };
  for (const f of doc.frames) {
    const s = f.source || {};
    if (isView(f) && s.scene) {
      for (const sl of s.scene.layers || []) {
        if (!sl.visible) continue;                            // a hidden layer in a scene isn't the figure's data
        const r = use(sl.name, s.keyFor ? 'key plan' : 'view'); r.visible = true;
        if (sl.color && !MODE_WORDS.has(sl.color)) r.cols.add(sl.color);
        if (sl.filter) r.filters.add(sl.filter);
        if (sl.box && !r.box) r.box = sl.box;
      }
    }
    if (s.kind === 'legend' && s.layer) use(s.layer, 'legend');
    if (s.recipe && s.recipe.params) {
      walkParams(s.recipe.params, recipeTop(s.recipe.params), {
        layer: (o, l) => use(l, 'chart'),
        col: (o, k, _, l) => { const r = use(l || recipeTop(s.recipe.params), 'chart'); if (r) r.cols.add(o[k]); },
        filter: (o, k, l) => { const r = use(l || recipeTop(s.recipe.params), 'chart'); if (r) r.filters.add(o[k]); },
      });
    }
    if (s.kind === 'resource' && s.params) {
      const p = s.params, r = use(p.layer, 'resource table');
      if (r) { if (p.grade) r.cols.add(p.grade); if (p.density && p.density.col) r.cols.add(p.density.col); for (const g of p.groupBy || []) r.cols.add(g); }
    }
    if (s.stereonet && s.stereonet.layer) use(s.stereonet.layer, 'stereonet');
    if (f.kind === 'text' && f.content && f.content.md) {
      eachStat(f.content.md, (m) => {
        const key = m[2].trim(), k = key.lastIndexOf(':');
        const lay = k >= 0 ? key.slice(0, k).trim() : statLayer(doc, f, key, m[3]);
        const r = use(lay, 'caption'); if (r) r.cols.add(k >= 0 ? key.slice(k + 1).trim() : key);
      });
    }
  }
  return [...by.values()];
}

const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function renameInExpr(expr, cols) {
  let e = String(expr);
  for (const [a, b] of Object.entries(cols || {})) if (b && a !== b) e = e.replace(new RegExp(`(^|[^\\w.])${rxEsc(a)}(?![\\w])`, 'g'), (_, p) => p + b);
  return e;
}
const centre = (b) => [0, 1, 2].map((i) => (b[0][i] + b[1][i]) / 2);
const diag = (b) => Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]) || 1;
const union = (bs) => { const ok = bs.filter(Boolean); if (!ok.length) return null; return [[0, 1, 2].map((i) => Math.min(...ok.map((b) => b[0][i]))), [0, 1, 2].map((i) => Math.max(...ok.map((b) => b[1][i])))]; };

// rewrite a document through a plan. `target(name)` → { name, label, box } of the NEW layer the
// old name maps to (null = left as it was). Mutates doc; returns a short report.
export function retargetDoc(doc, plan, target) {
  const L = plan.layers || {}, C = plan.columns || {}, placement = plan.placement || 'move';
  const newOf = (old) => (L[old] ? target(L[old]) : null);
  const col = (old, c) => { const m = C[old]; return m && m[c] ? m[c] : c; };
  const rep = { views: 0, charts: 0, tables: 0, stereonets: 0, legends: 0, captions: 0, moved: 0 };
  // a layer-less caption stat follows its answering layer's renames — worked out BEFORE the views
  // below take their new names
  const statOf = new Map();
  for (const f of doc.frames) if (f.kind === 'text' && f.content && f.content.md)
    eachStat(f.content.md, (m) => { const key = m[2].trim(); if (key.indexOf(':') < 0) statOf.set(f.id + '\u0000' + m[0], statLayer(doc, f, key, m[3])); });
  for (const f of doc.frames) {
    const s = f.source || {};
    if (isView(f) && s.scene) {
      const sc = s.scene, oldB = [], newB = [];
      for (const sl of sc.layers || []) {
        const t = newOf(sl.name); if (!t) continue;
        if (sl.visible) { oldB.push(sl.box || null); newB.push(t.box || null); }
        const old = sl.name;
        sl.name = t.name;
        if (sl.color && !MODE_WORDS.has(sl.color)) sl.color = col(old, sl.color);
        if (sl.filter) sl.filter = renameInExpr(sl.filter, C[old]);
        if (sl.color) delete sl.colorSel;                      // by name from here on — the old position means nothing
        if (t.box) sl.box = t.box; else delete sl.box;
        delete sl.sel;                                         // a selection is records of the OLD file
      }
      const ob = union(oldB), nb = union(newB), cam = sc.camera;
      if (cam && cam.target && nb) {
        if (ob && oldB.every(Boolean)) {
          const co = centre(ob), cn = centre(nb);
          if (placement === 'scale') {
            const k = diag(nb) / diag(ob);
            cam.target = cam.target.map((v, i) => cn[i] + (v - co[i]) * k); cam.radius *= k;
          } else cam.target = cam.target.map((v, i) => v + cn[i] - co[i]);
        } else { cam.target = centre(nb); cam.radius = Math.max(cam.radius || 0, diag(nb) * 0.9); }   // an older figure: no extent recorded — frame the new data
        rep.moved++;
      }
      const fx = factsOf(f);
      if (fx && fx.layers) for (const l of fx.layers) { const t = newOf(l.name); if (t) { l.name = t.label || t.name; l.sha = null; } }   // remade on ↻ refresh anyway
      rep.views++;
    }
    if (s.kind === 'legend' && s.layer && newOf(s.layer)) { s.layer = newOf(s.layer).name; rep.legends++; }
    if (s.recipe && s.recipe.params) {
      const top = recipeTop(s.recipe.params);
      walkParams(s.recipe.params, top, {
        layer: (o) => { const t = newOf(o.layer); if (t) o.layer = t.name; },
        col: (o, k, _, l) => { o[k] = col(l || top, o[k]); },
        filter: (o, k, l) => { o[k] = renameInExpr(o[k], C[l || top]); },
      });
      if (s.recipe.name && top && newOf(top)) s.recipe.name = s.recipe.name.replace(top.replace(/\.[^.]+$/, ''), (newOf(top).label || newOf(top).name).replace(/\.[^.]+$/, ''));
      rep[f.kind === 'chart' ? 'charts' : 'tables']++;
    }
    if (s.kind === 'resource' && s.params && newOf(s.params.layer)) {
      const p = s.params, old = p.layer;
      p.layer = newOf(old).name;
      if (p.grade) p.grade = col(old, p.grade);
      if (p.density && p.density.col) p.density.col = col(old, p.density.col);
      if (p.groupBy) p.groupBy = p.groupBy.map((g) => col(old, g));
      if (p.title) p.title = p.title.replace(old.replace(/\.[^.]+$/, ''), (newOf(old).label || newOf(old).name).replace(/\.[^.]+$/, ''));
      rep.tables++;
    }
    if (s.stereonet && newOf(s.stereonet.layer)) { s.stereonet.layer = newOf(s.stereonet.layer).name; rep.stereonets++; }
    if (s.facts && s.facts.layers) for (const l of s.facts.layers) { const t = newOf(l.name); if (t) { l.name = t.label || t.name; l.sha = null; } }
    if (f.kind === 'text' && f.content && f.content.md) {
      const md = String(f.content.md).replace(STAT_RE, (all, fn, key, tail) => {
        const k = key.lastIndexOf(':');
        if (k < 0) { const lay = statOf.get(f.id + '\u0000' + all); return lay ? `{${fn}:${col(lay, key.trim())}${tail}}` : all; }
        const lay = key.slice(0, k).trim(), c = key.slice(k + 1).trim(), t = newOf(lay);
        return t ? `{${fn}:${t.label || t.name}:${col(lay, c)}${tail}}` : all;
      });
      if (md !== f.content.md) { f.content = { ...f.content, md }; rep.captions++; }
    }
  }
  return rep;
}

// a first guess at the matching: the same name, else the same extension and the most shared
// columns, else the only candidate of the same kind
export function guessLayer(ref, cands) {
  const exact = cands.find((c) => c.name === ref.name || c.label === ref.name); if (exact) return exact.name;
  const score = (c) => [...ref.cols].filter((x) => c.cols.has(x) || [...c.cols].some((y) => y.toLowerCase() === x.toLowerCase())).length;
  const best = cands.map((c) => [score(c), c]).sort((a, b) => b[0] - a[0]);
  if (best.length && best[0][0] > 0 && (best.length === 1 || best[0][0] > best[1][0])) return best[0][1].name;
  return cands.length === 1 ? cands[0].name : '';
}
// a missing column → the same name in another case, else nothing (the dialog asks)
export function guessColumn(c, cols) {
  if (cols.has(c)) return c;
  return [...cols].find((x) => x.toLowerCase() === c.toLowerCase()) || '';
}
