// wuffle's COMMANDS — the console's language, pure: a line of text → an action on the project → a reply.
// Attitudes as everywhere in the GCU: a plane is dip direction/dip ("045/30"), a line trend→plunge
// ("045→30"; ">" types the arrow). Commands act on the ACTIVE diagram and its visible layers; a layer is
// named by its name or its dataset's (prefix is enough). The history is replayable: a routine is just lines.
//
// UI-side effects go through hooks the desk passes in ctx (all optional, so tests run without a DOM):
//   ctx.applyShape(shape, mode) → n   (draws the shape on the active net too)   ctx.setTheme(t)
//   ctx.focusDiagram(id)   ctx.openSample(name) → datasetId

import { conversions } from '../../../ext/bearing/index.js';
import { rowsInShape, formatPlane, formatLine } from '../../../ext/stereonet/index.js';
import { sceneLayers } from './layers.js';
import { layerStats, deriveMean, deriveEigen, deriveBeta, deriveIntersection } from './stats.js';

const ELEMENT_ALIASES = { poles: 'poles', pole: 'poles', points: 'points', circles: 'greatCircles', 'great-circles': 'greatCircles', greatcircles: 'greatCircles',
  contours: 'contours', contour: 'contours', mean: 'mean', eigen: 'eigen', eigenvectors: 'eigen', labels: 'labels', v1: 'v1Pole', v2: 'v2Pole', v3: 'v3Pole' };

/** "045/30" → plane [dd, dip] ; "045→30" / "045>30" → line [trend, plunge] ; else null */
export function parseAttitude(s) {
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*([/→>])\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = +m[1], b = +m[3];
  if (b > 90 || a > 360) return null;
  return m[2] === '/' ? { plane: [a % 360, b], dcos: conversions.planeToDcos(a % 360, b) } : { line: [a % 360, b], dcos: conversions.lineToDcos(a % 360, b) };
}

/** split a line into words, keeping "quoted names" whole */
export function tokenize(line) {
  const out = []; const re = /"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2]);
  return out;
}

const HELP = {
  help: 'help [command] — this list, or one command',
  sample: 'sample tocher — open the Tocher (1979) sample',
  diagrams: 'diagrams — list them;  use <name> — make one active',
  new: 'new net|rose|fabric — a new diagram with the active one\'s layers',
  layers: 'layers — the active diagram\'s layers',
  show: 'show <element> [layer] / hide <element> [layer] — poles, circles, contours, mean, eigen, labels, v1…v3',
  contour: 'contour kamb [k] | fisher [layer] — switch contours on, with their method',
  select: 'select cone <tr→pl|dd/dip> <angle> | band <dd/dip> <half-width> | all | none | invert   (+ adds, - subtracts: "select + cone …")',
  stats: 'stats [layer] — n, mean, κ, α95, eigenvalues',
  mean: 'mean [layer] / eigen [layer] / beta [layer] — keep the result as a dataset, drawn on this diagram',
  intersect: 'intersect <layer> <layer> — where their mean planes meet, as a dataset',
  rotate: 'rotate <tr→pl> | rotate off — centre the net on a direction',
  theme: 'theme dark|light|system',
  history: 'history — the lines typed so far (a routine is just these lines)',
};

export function createCommands(ctx) {
  const p = ctx.project, history = [];
  const active = () => { const g = p.diagram(p.activeDiagram); if (!g) throw new Error('no active diagram — new net'); return g; };
  const layerNamed = (name, { required = false } = {}) => {
    const g = active(), Ls = p.layersOf(g.id);
    if (!name) { const L = Ls.find((x) => x.visible) || Ls[0]; if (!L && required) throw new Error(`“${g.name}” has no layers`); return L; }
    const low = name.toLowerCase(), nm = (L) => (L.name || p.dataset(L.datasetId).name).toLowerCase();
    const L = Ls.find((x) => nm(x) === low) || Ls.find((x) => nm(x).startsWith(low));
    if (!L) throw new Error(`no layer “${name}” on ${g.name} — layers: ${Ls.map((x) => x.name || p.dataset(x.datasetId).name).join(', ') || 'none'}`);
    return L;
  };
  const dsName = (L) => L.name || p.dataset(L.datasetId).name;
  const derived = (id) => { p.addLayer(active().id, id); const d = p.dataset(id); return `→ ${d.name} (${d.rows.length} row${d.rows.length === 1 ? '' : 's'}), drawn on ${active().name}`; };
  const applyShape = (shape, mode) => {
    if (ctx.applyShape) return ctx.applyShape(shape, mode);
    let n = 0; const per = new Map();
    for (const L of sceneLayers(p, active().id)) { if (L.visible === false) continue; const s = per.get(L.datasetId) || new Set(); for (const r of rowsInShape(L.data, shape)) s.add(r); per.set(L.datasetId, s); }
    for (const [ds, rows] of per) { p.select(ds, [...rows], mode); n += rows.size; }
    return n;
  };

  const C = {
    help([name]) { if (name && HELP[name]) return HELP[name]; return Object.values(HELP).join('\n'); },
    sample([name = 'tocher']) { if (name !== 'tocher') throw new Error('samples: tocher'); const id = ctx.openSample ? ctx.openSample(name) : null; return id ? `opened ${p.dataset(id).name} (${p.dataset(id).rows.length} planes)` : 'no sample here'; },
    diagrams() { return p.diagrams.map((g) => `${g.id === p.activeDiagram ? '●' : '○'} ${g.name} (${g.kind}, ${p.layersOf(g.id).length} layers)`).join('\n') || 'none'; },
    use([...name]) { const n = name.join(' ').toLowerCase(); const g = p.diagrams.find((x) => x.name.toLowerCase() === n) || p.diagrams.find((x) => x.name.toLowerCase().startsWith(n)); if (!g) throw new Error(`no diagram “${name.join(' ')}”`); p.setActive(g.id); ctx.focusDiagram?.(g.id); return `● ${g.name}`; },
    new([kind = 'net']) {
      if (!['net', 'rose', 'fabric'].includes(kind)) throw new Error('new net|rose|fabric');
      const from = p.activeDiagram, id = p.addDiagram(kind); if (from) for (const L of p.layersOf(from)) p.addView(L.id, id);
      p.setActive(id); ctx.focusDiagram?.(id); return `● ${p.diagram(id).name}`;
    },
    layers() { const g = active(); return p.layersOf(g.id).map((L) => `${L.visible ? '☑' : '☐'} ${dsName(L)} · ${p.dataset(L.datasetId).kind} · ${p.dataset(L.datasetId).rows.length}`).join('\n') || `${g.name} is empty`; },
    show([el, ...name], on = true) {
      const key = ELEMENT_ALIASES[String(el).toLowerCase()]; if (!key) throw new Error(`show what? ${Object.keys(ELEMENT_ALIASES).join(', ')}`);
      const L = layerNamed(name.join(' '), { required: true }); p.setElement(L.id, key, on); return `${dsName(L)}: ${key} ${on ? 'on' : 'off'}`;
    },
    hide(args) { return C.show(args, false); },
    contour([method = 'kamb', k, ...name]) {
      if (!['kamb', 'fisher'].includes(method)) throw new Error('contour kamb [k] | fisher');
      const kk = method === 'kamb' && k && /^\d/.test(k) ? +k : null;
      const L = layerNamed((kk == null && k ? [k, ...name] : name).join(' '), { required: true });
      p.setElementSettings(L.id, 'contours', { method, ...(kk ? { sigma: kk } : {}) }); p.setElement(L.id, 'contours', true);
      return `${dsName(L)}: contours ${method}${method === 'kamb' ? ` ${kk || L.elements.contours.sigma}σ` : ''}`;
    },
    select(args) {
      let mode = 'replace'; if (args[0] === '+') { mode = 'add'; args = args.slice(1); } else if (args[0] === '-') { mode = 'subtract'; args = args.slice(1); }
      const [what, att, num] = args;
      if (what === 'none') { p.clearSelection(); return 'selection cleared'; }
      if (what === 'all' || what === 'invert') {
        let n = 0;
        for (const L of p.layersOf(active().id)) { const ds = p.dataset(L.datasetId), all = ds.rows.map((_, i) => i), cur = new Set(p.selected(ds.id));
          const rows = what === 'all' ? all : all.filter((i) => !cur.has(i)); p.select(ds.id, rows); n += rows.length; }
        return `${n} selected`;
      }
      const a = parseAttitude(att); if (!a) throw new Error(`“${att}” — a plane 045/30 or a line 045→30`);
      const v = +num; if (!(v > 0 && v <= 90)) throw new Error('an angle 0–90');
      let shape;
      if (what === 'cone') shape = { type: 'cone', axis: a.dcos, angle: v };          // a plane's cone is about its pole
      else if (what === 'band') { if (!a.plane) throw new Error('a band is about a plane: band 045/30 10'); shape = { type: 'band', pole: a.dcos, width: v }; }
      else throw new Error('select cone | band | all | none | invert');
      return `${what}: ${applyShape(shape, mode)} selected`;
    },
    stats([...name]) {
      const L = layerNamed(name.join(' '), { required: true }), ds = p.dataset(L.datasetId), s = layerStats(ds), isPlane = ds.kind !== 'lines';
      const out = [`${dsName(L)} · n ${s.n}`];
      if (s.mean) out.push(`mean ${isPlane ? formatPlane(s.mean.plane) + ' · pole ' : ''}${formatLine(s.mean.line)} · κ ${s.mean.kappa.toFixed(1)} · α95 ${s.mean.alpha.toFixed(1)}°`);
      if (s.eigen) out.push(`S ${s.eigen.values.map((x) => x.toFixed(3)).join(' ')} · K ${s.eigen.K.toFixed(2)} · C ${s.eigen.C.toFixed(2)}`);
      return out.join('\n');
    },
    mean([...name]) { return derived(deriveMean(p, layerNamed(name.join(' '), { required: true }).datasetId)); },
    eigen([...name]) { return derived(deriveEigen(p, layerNamed(name.join(' '), { required: true }).datasetId)); },
    beta([...name]) { return derived(deriveBeta(p, layerNamed(name.join(' '), { required: true }).datasetId)); },
    intersect([a, b]) { if (!a || !b) throw new Error('intersect <layer> <layer>'); return derived(deriveIntersection(p, layerNamed(a).datasetId, layerNamed(b).datasetId)); },
    rotate([att]) {
      const g = active(); if (g.kind !== 'net') throw new Error('only a net rotates');
      if (att === 'off' || att == null) { p.setDiagramProps(g.id, { rotation: null }); return `${g.name}: not rotated`; }
      const a = parseAttitude(att); if (!a || !a.line) throw new Error('rotate 045→30 (the direction to put at the centre)');
      p.setDiagramProps(g.id, { rotation: a.line }); return `${g.name}: centred on ${formatLine(a.line)}`;
    },
    theme([t]) { if (!['dark', 'light', 'system'].includes(t)) throw new Error('theme dark|light|system'); ctx.setTheme?.(t); return `theme ${t}`; },
    history() { return history.join('\n') || '(empty)'; },
  };

  /** run one line → { ok, text } (never throws) */
  function run(line) {
    const t = tokenize(String(line).replace(/#.*$/, '')); if (!t.length) return { ok: true, text: '' };
    const [cmd, ...args] = t, fn = C[cmd.toLowerCase()];
    if (cmd.toLowerCase() !== 'history') history.push(line.trim());
    if (!fn) return { ok: false, text: `unknown command “${cmd}” — try help` };
    try { return { ok: true, text: String(fn(args) ?? '') }; } catch (e) { return { ok: false, text: e.message }; }
  }
  /** a routine: many lines, stops at the first failure → [{ line, ok, text }] */
  function runAll(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) { if (!line.trim() || /^\s*#/.test(line)) continue; const r = run(line); out.push({ line, ...r }); if (!r.ok) break; }
    return out;
  }
  return { run, runAll, history, names: Object.keys(C) };
}
