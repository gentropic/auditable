// wuffle's COMMANDS — the console's language, pure: a line of text → an action on the project → a reply.
// Attitudes as everywhere in the GCU: a plane is dip direction/dip ("045/30"), a line trend→plunge
// ("045→30"; ">" types the arrow). Commands act on the ACTIVE diagram and its visible layers; a layer is
// named by its name or its dataset's (prefix is enough). The history is replayable: a routine is just lines.
//
// UI-side effects go through hooks the desk passes in ctx (all optional, so tests run without a DOM):
//   ctx.applyShape(shape, mode) → n   (draws the shape on the active net too)   ctx.setTheme(t)
//   ctx.focusDiagram(id)   ctx.openSample(name) → datasetId

import { conversions, io as bio } from '../../../ext/bearing/index.js';
import { rowsInShape, formatPlane, formatLine } from '../../../ext/stereonet/index.js';
import { sceneLayers } from './layers.js';
import { orientations } from './io.js';
import { rowsWhere } from './calc.js';
import { joinTable } from './join.js';
import { layerStats, deriveMean, deriveEigen, deriveBeta, deriveIntersection, applyTerzaghi, deriveRotated, deriveUntilted, deriveDeclination, detectSets, compareMeans, deriveLineations, applyKinematic, foldAnalysis, fitSmallCircle } from './stats.js';
import { declination as wmmDeclination } from '../../../ext/wmm/index.js';

const ELEMENT_ALIASES = { poles: 'poles', pole: 'poles', points: 'points', circles: 'greatCircles', 'great-circles': 'greatCircles', greatcircles: 'greatCircles',
  contours: 'contours', contour: 'contours', mean: 'mean', eigen: 'eigen', eigenvectors: 'eigen', labels: 'labels', v1: 'v1Pole', v2: 'v2Pole', v3: 'v3Pole' };

/**
 * "045/30" → plane [dd, dip] ; "045→30" / "045>30" → line [trend, plunge] ; else null.
 * as: 'plane' | 'line' — the kind is already known (add l 120/40, select cone l 150/60 20), so the
 * separator is only a separator: "/", "," or the arrow all read the same.
 */
export function parseAttitude(s, as = null) {
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*([/,→>])\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = +m[1], b = +m[3];
  if (b > 90 || a > 360) return null;
  const kind = as || (m[2] === '/' || m[2] === ',' ? 'plane' : 'line');
  return kind === 'plane' ? { plane: [a % 360, b], dcos: conversions.planeToDcos(a % 360, b) } : { line: [a % 360, b], dcos: conversions.lineToDcos(a % 360, b) };
}

// ── add: attitudes typed in. The kind word says what the numbers are; the numbers are read as a stream and
// grouped by the kind's size — so "045/30", "045,30" and "45 30" all read the same, and a list is just more ──
const ADD_KINDS = {
  p: 'planes', plane: 'planes', planes: 'planes',
  l: 'lines', line: 'lines', lines: 'lines', lineation: 'lines', lineations: 'lines',
  sc: 'smallcircles', small: 'smallcircles', smallcircle: 'smallcircles', smallcircles: 'smallcircles', cone: 'smallcircles',
  f: 'faults', fault: 'faults', faults: 'faults', slip: 'faults',
};
const ARITY = { planes: 2, lines: 2, smallcircles: 3, faults: 4 };
const NOUN = { planes: ['plane', 'planes'], lines: ['line', 'lines'], smallcircles: ['small circle', 'small circles'], faults: ['fault', 'faults'] };
const SENSE_RE = /^(n|r|i|d|s|\?|normal|reverse|inverse|thrust|dextral|sinistral|unknown)$/i;
const SENSE_NAME = { n: 'normal', r: 'reverse', i: 'reverse', d: 'dextral', s: 'sinistral', '?': '' };
const QUAD_RE = /^(N|NE|E|SE|S|SW|W|NW|NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW)$/i;
const fmt = (x) => String(+x.toFixed(1)).padStart(3, '0');

/** add's words → { kind, items: [{ plane?, line?, angle?, sense? }], flags } (throws, saying what to type) */
export function parseAdd(args) {
  const words = [...args], flags = {};
  const kind = ADD_KINDS[String(words.shift() || '').toLowerCase()];
  if (!kind) throw new Error('add p|l|sc|f <attitudes> — e.g. add p 045/30 · add l 120/40 · add sc 120/40 15 · add f 045/30 120/20 n');
  const vals = [];                                       // { v, q? } — q: a quadrant letter after a dip (030/40SE)
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^--/.test(w)) {
      const k = w.slice(2).toLowerCase();
      if (k === 'rhr' || k === 'strike') { flags.rhr = true; continue; }
      if (['to', 'net', 'label', 'name'].includes(k)) { const v = words[++i]; if (v == null) throw new Error(`--${k} needs a value`); flags[k === 'name' ? 'to' : k] = v; continue; }
      throw new Error(`add: unknown flag ${w} — --to <dataset> · --net <diagram> · --rhr · --label <text>`);
    }
    // a fault's slip as a RAKE on its plane: r35 (0–180 from the strike, right-hand rule) — two slots, like a trend/plunge
    if (kind === 'faults' && /^r\d+(\.\d+)?$/i.test(w)) {
      const rk = +w.slice(1); if (!(rk >= 0 && rk <= 180)) throw new Error(`“${w}”: a rake is 0–180 from the strike`);
      if (vals.length % 4 !== 2) throw new Error(`“${w}”: a rake comes after a fault's plane (add f 045/30 r35 n)`);
      vals.push({ v: rk, rake: true }, { v: 0, rake: true }); continue;
    }
    if (kind === 'faults' && SENSE_RE.test(w)) {
      if (vals.length % 4 !== 0 || !vals.length) throw new Error(`“${w}”: a sense comes after a fault's four numbers (add f 045/30 120/20 n)`);
      vals[vals.length - 1].sense = SENSE_NAME[w.toLowerCase()] ?? w.toLowerCase(); continue;
    }
    const m = w.match(/^(\d+(?:\.\d+)?)\s*[/,→>]\s*(\d+(?:\.\d+)?)\s*([A-Za-z]{1,3})?$/);
    if (m) {
      if (m[3] && !QUAD_RE.test(m[3])) throw new Error(`“${w}”: ${m[3]} isn't a compass quadrant`);
      vals.push({ v: +m[1] }, { v: +m[2], ...(m[3] ? { q: m[3].toUpperCase() } : {}) }); continue;
    }
    const q = w.match(/^(\d+(?:\.\d+)?)([A-Za-z]{1,3})?$/);
    if (q && (!q[2] || QUAD_RE.test(q[2]))) { vals.push({ v: +q[1], ...(q[2] ? { q: q[2].toUpperCase() } : {}) }); continue; }
    throw new Error(`“${w}” — not an attitude (045/30) or a number`);
  }
  const A = ARITY[kind];
  if (!vals.length) throw new Error(`add ${args[0]} what? e.g. ${{ planes: 'add p 045/30', lines: 'add l 120/40', smallcircles: 'add sc 120/40 15', faults: 'add f 045/30 120/20 n' }[kind]}`);
  if (vals.length % A) throw new Error(`add ${args[0]}: ${NOUN[kind][1]} take ${A} numbers each (${{ planes: 'dip direction / dip', lines: 'trend / plunge', smallcircles: 'axis trend / plunge, then the half-angle', faults: 'plane dip direction / dip, slip trend / plunge, [sense]' }[kind]}) — ${vals.length} given`);
  const plane = (a, b, at) => {                         // → [dd, dip]
    if (!(b.v >= 0 && b.v <= 90)) throw new Error(`${at}: a dip of ${b.v} — dips are 0–90`);
    if (!(a.v >= 0 && a.v <= 360)) throw new Error(`${at}: a direction of ${a.v} — 0–360`);
    if (b.q) return bio.translateAttitude(a.v, b.v, b.q, true);    // strike / dip + the quadrant it dips toward
    return [flags.rhr ? (a.v + 90) % 360 : a.v % 360, b.v];
  };
  const line = (a, b, at) => {
    if (a.q || b.q) throw new Error(`${at}: a quadrant is for a plane's dip`);
    if (!(b.v >= 0 && b.v <= 90)) throw new Error(`${at}: a plunge of ${b.v} — plunges are 0–90`);
    if (!(a.v >= 0 && a.v <= 360)) throw new Error(`${at}: a trend of ${a.v} — 0–360`);
    return [a.v % 360, b.v];
  };
  const items = [];
  for (let k = 0; k < vals.length; k += A) {
    const g = vals.slice(k, k + A), at = `${NOUN[kind][0]} ${k / A + 1}`;
    if (kind === 'planes') items.push({ plane: plane(g[0], g[1], at) });
    else if (kind === 'lines') items.push({ line: line(g[0], g[1], at) });
    else if (kind === 'smallcircles') {
      if (g[2].q || !(g[2].v > 0 && g[2].v < 180)) throw new Error(`${at}: a half-angle of ${g[2].v} — between 0 and 180`);
      items.push({ line: line(g[0], g[1], at), angle: g[2].v });
    } else {
      const pl = plane(g[0], g[1], at);
      const ln = g[2].rake ? conversions.dcosToLine(conversions.rakeToDcos(pl[0], pl[1], g[2].v)).map((x, i) => +(i ? x : ((x % 360) + 360) % 360).toFixed(2) % 360) : line(g[2], g[3], at);
      items.push({ plane: pl, line: ln, sense: g[3].sense ?? '', ...(g[2].rake ? { rake: g[2].v } : {}) });
    }
  }
  return { kind, items, flags };
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
  contour: 'contour kamb [k] | fisher [layer] [--filled | --lines] [--levels 2,4,6] — contours on, their method, filled bands, your levels',
  terzaghi: 'terzaghi [layer] <tr/pl> [--max 10] | terzaghi [layer] off — weight the planes for a scanline or borehole along tr/pl (contours use it)',
  add: 'add p 045/30 [more…] | l 120/40 | sc 120/40 15 | f 045/30 120/20 [n|r|d|s] (or f 045/30 r35 n: a rake) — typed in, into "typed <kind>"\n'
    + '    045/30, 045,30 or 45 30 · 030/40SE = strike/dip + quadrant · --rhr (strike/dip) · --to <dataset> · --net <diagram> · --label <text>',
  select: 'select cone [p|l] <dd/dip|tr/pl> <angle> | band <dd/dip> <half-width> | where "<expression>" | all | none | invert   (+ adds, - subtracts: "select + cone …")',
  stats: 'stats [layer] [--selection] [--bootstrap [n]] — n, mean, κ, α95, the confidence ellipse, Bingham uniformity, eigenvalues (the selected rows only, with --selection)',
  compare: 'compare <layer> <layer> — Watson\'s test: could the two share one mean?',
  calc: 'calc [--in <data>] <name> = "<expression>" | calc [--in <data>] (the formulas) | calc --drop <name> — a calculated column (@gcu/expr; dip, dipdir, strike, pole_trend, trend, plunge, rake are there too). QUOTE the expression: > and quotes are the shell\'s',
  join: 'join <data> <table> on <column>[=<table column>] — the table\'s columns onto the measurements, by a key, as a new dataset',
  kinematic: 'kinematic [layer] <face dd/dip> [--phi 30] [--lateral 20] — planar, wedge and toppling failure against a slope face (Markland); draws the face and the friction cone',
  fold: 'fold [layer] [--recumbent] [--keep] — the π-girdle\'s axis, cylindricity, interlimb angle, axial plane, Fleuty\'s names; --keep draws the axis and the axial plane',
  cone: 'cone [layer] [--keep] — the small circle that best fits (a conical fold\'s poles): its axis and half-angle',
  sets: 'sets [layer] [k] — find the sets (a mixture of Fisher distributions; without k the number is chosen by BIC), written as a set column',
  turn: 'turn [layer] about <tr/pl> <angle> — the DATA rotated (clockwise looking down the axis), as a new dataset (rotate turns the view)',
  untilt: 'untilt [layer] <dd/dip> — the data with a bedding\'s tilt taken out (rotated about its strike until it is flat), as a new dataset',
  declination: 'declination [layer] <degrees, east +> | --at <lat,lon> [--date YYYY-MM-DD] — magnetic → true north (WMM2025), as a new dataset',
  lineations: 'lineations <layer> <layer> — every plane of one against every plane of the other: the lines they meet in, as a dataset',
  mean: 'mean [layer] / eigen [layer] / beta [layer] — keep the result as a dataset, drawn on this diagram',
  intersect: 'intersect <layer> <layer> — where their mean planes meet, as a dataset',
  rotate: 'rotate <tr→pl> | rotate off — center the net on a direction',
  theme: 'theme dark|light|system',
  history: 'history — the lines typed so far (a routine is just these lines)',
  undo: 'undo / redo — the last change, whoever made it',
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
  const datasetNamed = (name) => {
    const low = String(name || '').toLowerCase(), d = p.datasets.find((x) => x.name.toLowerCase() === low) || p.datasets.find((x) => x.name.toLowerCase().startsWith(low));
    if (!d) throw new Error(`no dataset “${name}” — datasets: ${p.datasets.map((x) => x.name).join(', ') || 'none'}`); return d;
  };
  // a dataset named, or the active net's first visible layer's
  const dataOf = (name) => { if (name) { try { return p.dataset(layerNamed(name).datasetId); } catch { return datasetNamed(name); } } return p.dataset(layerNamed('', { required: true }).datasetId); };
  const derived = (make) => { const id = p.batch('derive', () => { const x = make(); p.addLayer(active().id, x); return x; }); const d = p.dataset(id); return `→ ${d.name} (${d.rows.length} row${d.rows.length === 1 ? '' : 's'}), drawn on ${active().name}`; };
  const applyShape = (shape, mode) => {
    if (ctx.applyShape) return ctx.applyShape(shape, mode);
    let n = 0; const per = new Map();
    for (const L of sceneLayers(p, active().id)) { if (L.visible === false) continue; const s = per.get(L.datasetId) || new Set(); for (const r of rowsInShape(L.data, shape)) s.add(r); per.set(L.datasetId, s); }
    for (const [ds, rows] of per) { p.select(ds, [...rows], mode); n += rows.size; }
    return n;
  };

  const ROLE_OF = { planes: { dipDir: 'dipdir', dip: 'dip' }, lines: { trend: 'trend', plunge: 'plunge' },
    smallcircles: { trend: 'trend', plunge: 'plunge', angle: 'angle' }, faults: { dipDir: 'dipdir', dip: 'dip', trend: 'trend', plunge: 'plunge', sense: 'sense' } };
  // an item as a row of a dataset — in ITS columns and notation (dip direction, or strike for a right-hand-rule set)
  const rowFor = (ds, it, label) => {
    const r = ds.roles, row = {};
    if (it.plane) {
      if (r.attitude) row[r.attitude] = `${fmt(it.plane[0])}/${fmt(it.plane[1]).replace(/^0(?=\d\d)/, '')}`;
      else if (r.dipDir) { row[r.dipDir] = it.plane[0]; row[r.dip] = it.plane[1]; }
      else if (r.strike && !r.quadrant) { row[r.strike] = (it.plane[0] + 270) % 360; row[r.dip] = it.plane[1]; }
      else throw new Error(`“${ds.name}” keeps its planes as strike + quadrant — add to a new dataset (--to <new name>)`);
    }
    if (it.line) { if (r.attitude && ds.kind === 'lines') row[r.attitude] = `${fmt(it.line[0])}→${it.line[1]}`; else { row[r.trend] = it.line[0]; row[r.plunge] = it.line[1]; } }
    if (it.angle != null) row[r.angle] = it.angle;
    if (ds.kind === 'faults' && r.sense) row[r.sense] = it.sense || '';
    if (label != null) row.label = label;
    return row;
  };
  const diagramNamed = (name) => {
    const n = name.toLowerCase(), g = p.diagrams.find((x) => x.name.toLowerCase() === n) || p.diagrams.find((x) => x.name.toLowerCase().startsWith(n));
    if (!g) throw new Error(`no diagram “${name}” — diagrams: ${p.diagrams.map((x) => x.name).join(', ') || 'none'}`); return g;
  };

  const C = {
    add(args) {
      const { kind, items, flags } = parseAdd(args);
      const g = flags.net ? diagramNamed(flags.net) : active();
      const want = flags.to || `typed ${kind === 'smallcircles' ? 'small circles' : kind}`;
      const low = want.toLowerCase();
      let ds = p.datasets.find((d) => d.name.toLowerCase() === low) || (flags.to ? p.datasets.find((d) => d.name.toLowerCase().startsWith(low)) : null);
      if (ds && ds.kind !== kind) {
        if (flags.to) throw new Error(`“${ds.name}” holds ${ds.kind}, not ${kind} — add ${args[0]} … --to <another name>`);
        ds = null;                                         // a "typed planes" that someone made lines: start another
      }
      // a slip line off its plane is a typo more often than not: said, not refused (the numbers are yours)
      const notes = [];
      if (kind === 'faults') items.forEach((it, i) => {
        const pole = conversions.planeToDcos(it.plane[0], it.plane[1]), l = conversions.lineToDcos(it.line[0], it.line[1]);
        const off = Math.abs(90 - Math.acos(Math.min(1, Math.abs(pole[0] * l[0] + pole[1] * l[1] + pole[2] * l[2]))) * 180 / Math.PI);
        if (off > 10) notes.push(`fault ${i + 1}: the slip line is ${off.toFixed(0)}° off its plane — check the numbers`);
      });
      const made = !ds;
      const id = p.batch(`add ${NOUN[kind][items.length === 1 ? 0 : 1]}`, () => {
        let did = ds && ds.id;
        if (!did) {
          const roles = { ...ROLE_OF[kind] };
          const probe = { name: want, kind, roles };
          const rows = items.map((it) => rowFor(probe, it, flags.label));
          did = p.addDataset({ name: want, kind, rows, roles, notation: 'dd', lineage: { op: 'typed', params: {}, sources: [], at: new Date().toISOString() } });
        } else {
          const d0 = p.dataset(did); p.editRows(did, (rows) => [...rows, ...items.map((it) => rowFor(d0, it, flags.label))]);
        }
        if (!p.layersOf(g.id).some((L) => L.datasetId === did)) p.addLayer(g.id, did);
        return did;
      });
      const d = p.dataset(id), what = items.map((it) => it.plane && it.line ? `${formatPlane(it.plane)} ${formatLine(it.line)}${it.sense ? ' ' + it.sense : ''}`
        : it.plane ? formatPlane(it.plane) : `${formatLine(it.line)}${it.angle != null ? ` ±${it.angle}°` : ''}`);
      const head = `+${items.length} ${NOUN[kind][items.length === 1 ? 0 : 1]} → ${d.name}${made ? ' (new)' : ''} · ${d.rows.length} row${d.rows.length === 1 ? '' : 's'}, on ${g.name}`;
      return [head, '  ' + what.join(' · '), ...notes].join('\n');
    },
    help([name]) { if (name && HELP[name]) return HELP[name]; return Object.values(HELP).join('\n'); },
    sample([name = 'tocher']) { if (name !== 'tocher') throw new Error('samples: tocher'); const id = ctx.openSample ? ctx.openSample(name) : null; return id ? `opened ${p.dataset(id).name} (${p.dataset(id).rows.length} planes)` : 'no sample here'; },
    diagrams() { return p.diagrams.map((g) => `${g.id === p.activeDiagram ? '●' : '○'} ${g.name} (${g.kind}, ${p.layersOf(g.id).length} layers)`).join('\n') || 'none'; },
    use([...name]) { const n = name.join(' ').toLowerCase(); const g = p.diagrams.find((x) => x.name.toLowerCase() === n) || p.diagrams.find((x) => x.name.toLowerCase().startsWith(n)); if (!g) throw new Error(`no diagram “${name.join(' ')}”`); p.setActive(g.id); ctx.focusDiagram?.(g.id); return `● ${g.name}`; },
    new([kind = 'net']) {
      if (!['net', 'rose', 'fabric'].includes(kind)) throw new Error('new net|rose|fabric');
      const from = p.activeDiagram, id = p.batch(`new ${kind}`, () => { const g = p.addDiagram(kind); if (from) for (const L of p.layersOf(from)) p.addView(L.id, g); return g; });
      p.setActive(id); ctx.focusDiagram?.(id); return `● ${p.diagram(id).name}`;
    },
    layers() { const g = active(); return p.layersOf(g.id).map((L) => `${L.visible ? '☑' : '☐'} ${dsName(L)} · ${p.dataset(L.datasetId).kind} · ${p.dataset(L.datasetId).rows.length}`).join('\n') || `${g.name} is empty`; },
    show([el, ...name], on = true) {
      const key = ELEMENT_ALIASES[String(el).toLowerCase()]; if (!key) throw new Error(`show what? ${Object.keys(ELEMENT_ALIASES).join(', ')}`);
      const L = layerNamed(name.join(' '), { required: true }); p.setElement(L.id, key, on); return `${dsName(L)}: ${key} ${on ? 'on' : 'off'}`;
    },
    hide(args) { return C.show(args, false); },
    contour(args0) {
      // flags first: --filled / --lines, --levels a,b,c
      const flags = {}, rest = [];
      for (let i = 0; i < args0.length; i++) {
        const a = args0[i];
        if (a === '--filled') flags.filled = true; else if (a === '--lines') flags.filled = false;
        else if (a === '--levels') { const v = String(args0[++i] || '').split(/[,\s]+/).map(Number).filter(Number.isFinite); if (!v.length) throw new Error('--levels 2,4,6'); flags.levels = v.sort((x, y) => x - y); }
        else rest.push(a);
      }
      const [method = 'kamb', k, ...name] = rest;
      if (!['kamb', 'fisher'].includes(method)) throw new Error('contour kamb [k] | fisher');
      const kk = method === 'kamb' && k && /^\d/.test(k) ? +k : null;
      const L = layerNamed((kk == null && k ? [k, ...name] : name).join(' '), { required: true });
      p.batch('contours', () => { p.setElementSettings(L.id, 'contours', { method, ...(kk ? { sigma: kk } : {}), ...('filled' in flags ? { filled: flags.filled } : {}), ...(flags.levels ? { levels: flags.levels } : {}) }); p.setElement(L.id, 'contours', true); });
      const E = p.layer(L.id).elements.contours;
      return `${dsName(L)}: contours ${method}${method === 'kamb' ? ` ${E.sigma ?? 3}σ` : ''}${E.filled ? ', filled' : ''}${E.levels ? ` at ${E.levels.join(', ')}` : ''}`;
    },
    select(args) {
      let mode = 'replace'; if (args[0] === '+') { mode = 'add'; args = args.slice(1); } else if (args[0] === '-') { mode = 'subtract'; args = args.slice(1); }
      let [what, att, num] = args, as = null;
      if (ADD_KINDS[String(att).toLowerCase()] === 'planes' || ADD_KINDS[String(att).toLowerCase()] === 'lines') { as = ADD_KINDS[String(att).toLowerCase()] === 'planes' ? 'plane' : 'line'; [att, num] = [num, args[3]]; }
      if (what === 'none') { p.clearSelection(); return 'selection cleared'; }
      if (what === 'where') {                                // an expression over the rows, on every dataset this net shows
        const expr = args.slice(1).join(' ').trim(); if (!expr) throw new Error('select where "<expression>" — e.g. select where "dip > 60 and set = \'S1\'"');
        const ids = [...new Set(p.layersOf(active().id).filter((L) => L.visible !== false).map((L) => L.datasetId))];
        let n = 0, of = 0, errs = [];
        for (const id of ids) {
          const ds = p.dataset(id); of += ds.rows.length;
          let rows; try { rows = rowsWhere(ds, expr); } catch (e) { errs.push(`${ds.name}: ${e.message}`); continue; }
          p.select(id, rows, mode); n += rows.length;
        }
        if (errs.length === ids.length && ids.length) throw new Error(errs[0]);
        return `where ${expr}: ${n} of ${of} selected${errs.length ? ` (skipped ${errs.map((e) => e.split(':')[0]).join(', ')}: ${errs[0].split(': ').slice(1).join(': ').split(' — ')[0]})` : ''}`;
      }
      if (what === 'all' || what === 'invert') {
        // once per DATASET drawn (visibly) on the net — two views of one dataset used to invert it twice (no change)
        // and count its rows twice; a hidden layer is left alone, as a gesture leaves it
        let n = 0;
        const dsIds = [...new Set(p.layersOf(active().id).filter((L) => L.visible !== false).map((L) => L.datasetId))];
        for (const id of dsIds) { const ds = p.dataset(id), all = ds.rows.map((_, i) => i), cur = new Set(p.selected(id));
          const rows = what === 'all' ? all : all.filter((i) => !cur.has(i)); p.select(id, rows); n += rows.length; }
        return `${n} selected`;
      }
      const a = parseAttitude(att, as); if (!a) throw new Error(`“${att}” — a plane 045/30 or a line 045→30 (or say which: cone l 150/60 20)`);
      const v = +num; if (!(v > 0 && v <= 90)) throw new Error('an angle 0–90');
      let shape;
      if (what === 'cone') shape = { type: 'cone', axis: a.dcos, angle: v };          // a plane's cone is about its pole
      else if (what === 'band') { if (!a.plane) throw new Error('a band is about a plane: band 045/30 10'); shape = { type: 'band', pole: a.dcos, width: v }; }
      else throw new Error('select cone | band | all | none | invert');
      return `${what}: ${applyShape(shape, mode)} selected`;
    },
    terzaghi(args) {
      let max = 10; const rest = [];
      for (let i = 0; i < args.length; i++) { if (args[i] === '--max') max = +args[++i]; else rest.push(args[i]); }
      const last = rest[rest.length - 1];
      if (last === 'off') { const L = layerNamed(rest.slice(0, -1).join(' '), { required: true }); p.setRoles(L.datasetId, { weight: null }); return `${dsName(L)}: unweighted (the terzaghi_w column stays)`; }
      const a = parseAttitude(last || '', 'line'); if (!a) throw new Error('terzaghi [layer] <tr/pl> — the scanline or borehole, as trend/plunge');
      const L = layerNamed(rest.slice(0, -1).join(' '), { required: true });
      if (!['planes', 'faults'].includes(p.dataset(L.datasetId).kind)) throw new Error(`${dsName(L)} isn't planes — Terzaghi weights planes sampled along a line`);
      const r = applyTerzaghi(p, L.datasetId, a.line, { max });
      return `${dsName(L)}: Terzaghi weights for a line ${formatLine(a.line)} — ${r.n} planes, ${r.min.toFixed(2)}–${r.max.toFixed(2)}${r.capped ? `, ${r.capped} capped at ${max}` : ''}; contours weighted (statistics are not)`;
    },
    stats(args0) {
      let boot = 0; const args = [];
      for (let i = 0; i < args0.length; i++) { if (args0[i] === '--bootstrap') { boot = /^\d+$/.test(args0[i + 1] || '') ? +args0[++i] : 1000; } else args.push(args0[i]); }
      const part = args.some((a) => /^(--?sel(ection)?|sel(ection)?)$/i.test(a)), name = args.filter((a) => !/^(--?sel(ection)?|sel(ection)?)$/i.test(a));
      const L = layerNamed(name.join(' '), { required: true }), ds = p.dataset(L.datasetId), isPlane = ds.kind !== 'lines';
      const rows = part ? p.selected(ds.id) : null;
      if (part && !rows.length) throw new Error(`nothing selected in ${dsName(L)} — select some (select cone …, or on the net), then stats --selection`);
      const s = layerStats(ds, { ...(rows ? { rows } : {}), bootstrap: boot });
      const out = [`${dsName(L)}${part ? ` · selection` : ''} · n ${s.n}${part ? ` of ${ds.rows.length}` : ''}`];
      if (s.mean) out.push(`mean ${isPlane ? formatPlane(s.mean.plane) + ' · pole ' : ''}${formatLine(s.mean.line)} · κ ${s.mean.kappa.toFixed(1)} · α95 ${s.mean.alpha.toFixed(1)}°`);
      if (s.ellipse) out.push(`95 % ellipse ${s.ellipse.a.toFixed(1)}° × ${s.ellipse.b.toFixed(1)}°, long axis toward ${formatLine(s.ellipse.azimuth)}`);
      if (s.bootstrap) out.push(`bootstrap cone ${s.bootstrap.halfAngle.toFixed(1)}° (${s.bootstrap.iterations} resamplings)`);
      if (s.eigen) out.push(`S ${s.eigen.values.map((x) => x.toFixed(3)).join(' ')} · K ${s.eigen.K.toFixed(2)} · C ${s.eigen.C.toFixed(2)}`);
      if (s.uniformity) out.push(`uniformity (Bingham): p ${s.uniformity.p < 0.001 ? '< 0.001' : s.uniformity.p.toFixed(3)} — ${s.uniformity.p < 0.05 ? 'a preferred orientation' : 'no preferred orientation shown (could be uniform)'}`);
      return out.join('\n');
    },
    compare([a, b]) {
      if (!a || !b) throw new Error('compare <layer> <layer>');
      const A = layerNamed(a), B = layerNamed(b), r = compareMeans(p.dataset(A.datasetId), p.dataset(B.datasetId));
      return `${dsName(A)} (n ${r.nA}) vs ${dsName(B)} (n ${r.nB}) — Watson F ${r.F.toFixed(2)} (${r.df[0]}, ${r.df[1]}), p ${r.p < 0.001 ? '< 0.001' : r.p.toFixed(3)}: `
        + (r.p < 0.05 ? 'their means differ (at 95 %)' : 'one mean could serve both (the test can\'t tell them apart at 95 %)');
    },
    calc(args0) {
      let into = null, drop = null; const args = [];
      for (let i = 0; i < args0.length; i++) { if (args0[i] === '--in') into = args0[++i]; else if (args0[i] === '--drop') drop = args0[++i]; else args.push(args0[i]); }
      const ds = dataOf(into);
      if (drop) { p.dropCalc(ds.id, drop); return `${ds.name}: “${drop}” dropped (the formula and its column)`; }
      const line = args.join(' ').trim();
      if (!line) { const c = (ds.meta && ds.meta.calc) || []; return c.length ? c.map((x) => `${ds.name} · ${x.name} = ${x.expr}`).join('\n') : `${ds.name} has no calculated columns — calc <name> = "<expression>"`; }
      const m = line.match(/^([^=\s][^=]*?)\s*=\s*([\s\S]+)$/); if (!m) throw new Error('calc <name> = "<expression>"');
      const name = m[1].trim(), expr = m[2].trim();
      const broken = p.setCalc(ds.id, name, expr), d2 = p.dataset(ds.id);
      const sample = d2.rows.slice(0, 3).map((r) => r[name]).map((v) => (v === '' ? '·' : String(v))).join(', ');
      return `${d2.name} · ${name} = ${expr}  (${sample}${d2.rows.length > 3 ? ', …' : ''})${broken.length ? ` — not computed: ${broken.join(', ')}` : ''}`;
    },
    join(args) {
      const at = args.indexOf('on'); if (at !== 2 || !args[3]) throw new Error('join <data> <table> on <column>[=<table column>]');
      const D = dataOf(args[0]), T = datasetNamed(args[1]), [a, b] = args[3].split('=');
      const r = joinTable(p, D.id, T.id, { on: a, onTable: b || null });
      const g = p.activeDiagram; if (g && p.layersOf(g).some((L) => L.datasetId === D.id)) p.addLayer(g, r.id);
      return `→ ${p.dataset(r.id).name}: ${r.matched} of ${r.of} matched, ${r.columns.length} column${r.columns.length === 1 ? '' : 's'} brought (${r.columns.join(', ')})`
        + (r.unmatched.length ? `; no ${T.name} row for ${r.unmatched.slice(0, 6).join(', ')}${r.unmatched.length > 6 ? ` and ${r.unmatched.length - 6} more` : ''}` : '')
        + (r.dupes ? `; ${r.dupes} key${r.dupes === 1 ? '' : 's'} twice in ${T.name} (the first row taken)` : '');
    },
    kinematic(args0) {
      let phi = 30, lateral = 20; const args = [];
      for (let i = 0; i < args0.length; i++) {
        if (args0[i] === '--phi') phi = +args0[++i]; else if (args0[i] === '--lateral') lateral = +args0[++i]; else args.push(args0[i]);
      }
      if (!(phi >= 0 && phi < 90)) throw new Error('--phi: the friction angle, 0–90');
      if (!(lateral > 0 && lateral <= 90)) throw new Error('--lateral: the lateral limit, 1–90 (20 is customary)');
      const f = parseAttitude(args[args.length - 1] || '', 'plane'); if (!f) throw new Error('kinematic [layer] <face dd/dip> — the slope face, e.g. kinematic 180/60 --phi 30');
      const L = layerNamed(args.slice(0, -1).join(' '), { required: true }), g = active();
      if (!['planes', 'faults'].includes(p.dataset(L.datasetId).kind)) throw new Error(`${dsName(L)} isn't planes`);
      const r = applyKinematic(p, L.datasetId, { face: f.plane, phi, lateral });
      p.batch('draw the slope', () => { p.addLayer(g.id, r.faceId); p.addLayer(g.id, r.coneId); });
      const pc = (k) => `${k} (${((k / Math.max(1, r.n)) * 100).toFixed(0)} %)`;
      return [`${dsName(L)} against the face ${formatPlane(f.plane)}, φ ${phi}°, lateral limit ±${lateral}° — ${r.n} planes`,
        `  planar   ${pc(r.planar)}`, `  wedge    ${r.wedges} of ${r.pairs} pairs (${((r.wedges / Math.max(1, r.pairs)) * 100).toFixed(1)} %)`, `  toppling ${pc(r.toppling)}`,
        '  each plane\'s modes are in its “kinematic” column (sort the table by it to see them); the face and the friction cone are drawn'].join('\n');
    },
    fold(args0) {
      const recumbent = args0.includes('--recumbent'), keep = args0.includes('--keep'), args = args0.filter((a) => !/^--/.test(a));
      const L = layerNamed(args.join(' '), { required: true }), ds = p.dataset(L.datasetId), r = foldAnalysis(ds, { recumbent });
      const out = [`${dsName(L)} · n ${r.n} — fold axis ${formatLine(r.axis)} (${r.plunge}), π-girdle ${formatPlane(r.girdle)}, cylindricity ${(r.cylindricity * 100).toFixed(1)} %`];
      if (r.limbs) out.push(`  limbs ${r.limbs.map(formatPlane).join(' and ')} — interlimb ${r.interlimb.toFixed(0)}° (${r.tightness}); axial plane ${formatPlane(r.axialPlane)} (${r.attitude})`,
        `  ${recumbent ? 'the shallower bisector taken as the axial plane (--recumbent)' : 'the steeper bisector taken as the axial plane — a recumbent fold: --recumbent'}`);
      if (r.cylindricity < 0.9) out.push('  the poles don\'t sit well on one great circle: a conical fold? try cone');
      if (keep) {
        const id = p.batch('fold', () => {
          const a = p.derive({ name: `${ds.name} · fold axis`, kind: 'lines', rows: [{ trend: +r.axis[0].toFixed(2), plunge: +r.axis[1].toFixed(2) }], roles: { trend: 'trend', plunge: 'plunge' }, notation: 'dd', op: 'fold axis', params: {}, sources: [ds.id] });
          p.addLayer(active().id, a);
          if (r.axialPlane) { const b = p.derive({ name: `${ds.name} · axial plane`, kind: 'planes', rows: [{ 'dip direction': +r.axialPlane[0].toFixed(2), dip: +r.axialPlane[1].toFixed(2) }], roles: { dipDir: 'dip direction', dip: 'dip' }, notation: 'dd', op: 'axial plane', params: { recumbent }, sources: [ds.id] }); p.addLayer(active().id, b); }
          return a;
        });
        out.push(`  → ${p.dataset(id).name}${r.axialPlane ? ' and the axial plane' : ''}, drawn on ${active().name}`);
      }
      return out.join('\n');
    },
    cone(args0) {
      const keep = args0.includes('--keep'), args = args0.filter((a) => !/^--/.test(a));
      const L = layerNamed(args.join(' '), { required: true }), ds = p.dataset(L.datasetId);
      const dirs = orientations(ds).filter(Boolean).map((o) => o.pole || o.dcos), r = fitSmallCircle(dirs);
      const out = `${dsName(L)} · n ${dirs.length} — best small circle: axis ${formatLine(r.axis)}, half-angle ${r.angle.toFixed(1)}°, rms ${r.rms.toFixed(1)}°`;
      if (!keep) return out;
      return out + '\n' + derived(() => p.derive({ name: `${ds.name} · best cone`, kind: 'smallcircles', rows: [{ trend: r.axis[0], plunge: r.axis[1], angle: r.angle }], roles: { trend: 'trend', plunge: 'plunge', angle: 'angle' }, notation: 'dd', op: 'small-circle fit', params: { rms: r.rms }, sources: [ds.id] }));
    },
    sets([...args]) {
      const k = /^\d+$/.test(args[args.length - 1] || '') ? +args.pop() : null;
      if (k != null && !(k >= 1 && k <= 9)) throw new Error('sets [layer] [k 1–9]');
      const L = layerNamed(args.join(' '), { required: true }), r = detectSets(p, L.datasetId, k);
      return [`${dsName(L)}: ${r.k} set${r.k === 1 ? '' : 's'}${r.chose ? ' (the number chosen by BIC)' : ''} — written as the column “set”`,
        ...r.sets.map((x) => `  ${x.name}  n ${x.n} (${(x.weight * 100).toFixed(0)} %)  ${x.plane ? formatPlane(x.plane) + ' · pole ' : ''}${formatLine(x.axis)}  κ ${x.kappa.toFixed(1)}`)].join('\n');
    },
    turn(args) {
      const at = args.indexOf('about'); if (at < 0 || args.length < at + 3) throw new Error('turn [layer] about <tr/pl> <angle>');
      const a = parseAttitude(args[at + 1], 'line'), ang = +args[at + 2];
      if (!a || !Number.isFinite(ang)) throw new Error('turn [layer] about <tr/pl> <angle> — e.g. turn about 045/30 20');
      const L = layerNamed(args.slice(0, at).join(' '), { required: true });
      return derived(() => deriveRotated(p, L.datasetId, { axis: a.line, angle: ang }));
    },
    untilt(args) {
      const a = parseAttitude(args[args.length - 1] || '', 'plane'); if (!a) throw new Error('untilt [layer] <dd/dip> — the bedding to take back to horizontal');
      const L = layerNamed(args.slice(0, -1).join(' '), { required: true });
      return derived(() => deriveUntilted(p, L.datasetId, a.plane));
    },
    declination(args0) {
      let at = null, date = new Date(); const args = [];
      for (let i = 0; i < args0.length; i++) {
        if (args0[i] === '--at') { const m = String(args0[++i] || '').split(',').map(Number); if (m.length !== 2 || !m.every(Number.isFinite)) throw new Error('--at lat,lon (decimal degrees)'); at = m; }
        else if (args0[i] === '--date') { const d = new Date(args0[++i]); if (isNaN(d)) throw new Error('--date YYYY-MM-DD'); date = d; }
        else args.push(args0[i]);
      }
      let deg, source = null;
      if (at) { deg = wmmDeclination(at[0], at[1], date); source = `WMM2025 at ${at[0]}, ${at[1]} on ${date.toISOString().slice(0, 10)}`; }
      else { const v = args.pop(); deg = +v; if (!Number.isFinite(deg)) throw new Error('declination [layer] <degrees, east +> | --at lat,lon [--date YYYY-MM-DD]'); }
      if (Math.abs(deg) > 90) throw new Error(`a declination of ${deg}° — near a magnetic pole a compass can't be corrected`);
      const L = layerNamed(args.join(' '), { required: true });
      const out = derived(() => deriveDeclination(p, L.datasetId, deg, { source }));
      return `${source ? `declination ${deg >= 0 ? '+' : ''}${deg.toFixed(2)}° (${source}) ` : ''}${out}`;
    },
    lineations([a, b]) {
      if (!a || !b) throw new Error('lineations <layer> <layer>');
      return derived(() => deriveLineations(p, layerNamed(a).datasetId, layerNamed(b).datasetId));
    },
    mean([...name]) { const L = layerNamed(name.join(' '), { required: true }); return derived(() => deriveMean(p, L.datasetId)); },
    eigen([...name]) { const L = layerNamed(name.join(' '), { required: true }); return derived(() => deriveEigen(p, L.datasetId)); },
    beta([...name]) { const L = layerNamed(name.join(' '), { required: true }); return derived(() => deriveBeta(p, L.datasetId)); },
    intersect([a, b]) { if (!a || !b) throw new Error('intersect <layer> <layer>'); const A = layerNamed(a).datasetId, Bd = layerNamed(b).datasetId; return derived(() => deriveIntersection(p, A, Bd)); },
    undo() { const l = p.undo(); return l ? `undid ${l}` : 'nothing to undo'; },
    redo() { const l = p.redo(); return l ? `redid ${l}` : 'nothing to redo'; },
    rotate([att]) {
      const g = active(); if (g.kind !== 'net') throw new Error('only a net rotates');
      if (att === 'off' || att == null) { p.setDiagramProps(g.id, { rotation: null, matrix: null }); return `${g.name}: not rotated`; }
      const a = parseAttitude(att); if (!a || !a.line) throw new Error('rotate 045→30 (the direction to put at the center)');
      p.setDiagramProps(g.id, { rotation: a.line, matrix: null }); return `${g.name}: centered on ${formatLine(a.line)}`;
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
