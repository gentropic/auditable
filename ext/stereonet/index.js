// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/stereonet — Declarative, interactive, reactive stereonet cells (structural geology) — built on @gcu/bearing.

// ── src/format.js ──

// @gcu/stereonet — attitudes as text, one way for every GCU surface: planes as dip direction/dip ("045/72"),
// lines as trend→plunge ("045→32", the way wuffle's field compass reads typed lines). Whole degrees;
// azimuths three digits, dips and plunges two. (Decided 2026-11-26; micro's measure readout follows.)

const az = (v) => String(((Math.round(v) % 360) + 360) % 360).padStart(3, '0');
const dp = (v) => String(Math.round(v)).padStart(2, '0');

/** [dipDirection, dip] → "045/72" */
const formatPlane = ([dd, dip]) => `${az(dd)}/${dp(dip)}`;
/** [trend, plunge] → "045→32" */
const formatLine = ([trend, plunge]) => `${az(trend)}→${dp(plunge)}`;

// ── src/core.js ──

// @gcu/stereonet — the CORE: plain layers of orientation data → a SCENE (primitives + statistics) → a
// @gcu/bearing net, with picking back to (layer, row). Shared by every GCU surface that draws a net: the
// notebook cell, wuffle's desk, compo figure frames, micro's structure window.
//
// bearing is INJECTED, not imported (stereonetCore(bearing)): this package keeps no static imports, so a
// notebook can load it as a plain module and hand it the bearing it loaded at run time; an app passes its
// own copy. Same shape as the workbench services.
//
// A layer is plain data — no app model behind it:
//   { id, kind: 'planes' | 'lines' | 'faults' | 'smallcircles', visible?, color, size?,
//     elements: { poles, points, greatCircles, contours, mean, v1Pole … v3Circle, circles, axes, slip, … }
//               each { on, …settings } (contours: method 'kamb'|'fisher', sigma, levels; mean: axial, confidence),
//     data: [{ row, plane?: [dd, dip], pole?: dcos, line?: [trend, plunge], dcos?: dcos, angle? }],
//     selected?: Iterable<row> }
// Draw order: layers in order (last on top); inside a layer, contours under circles under points.

const EIGEN = ['v1Pole', 'v1Circle', 'v2Pole', 'v2Circle', 'v3Pole', 'v3Circle'];

/** the pick nearest (x, y) in svg units, within radius; null if none */
function nearestPick(picks, x, y, radius = 8) {
  let best = null, bd = radius;
  for (const k of picks) { const d = Math.hypot(k.x - x, k.y - y); if (d < bd) { bd = d; best = k; } }
  return best;
}

/**
 * @param {object} B - the @gcu/bearing module (needs statistics, conversions, Stereonet)
 * @returns {{ buildScene: Function, renderScene: Function, nearestPick: Function }}
 */
function stereonetCore(B) {
  if (!B || !B.statistics || !B.conversions || !B.Stereonet) throw new Error('stereonetCore: pass the @gcu/bearing module');
  const { statistics, conversions, Stereonet, fault } = B;
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  // the hanging wall's motion as an arrow at the slickenline's point (Angelier's convention): the point is the
  // slip vector's lower-hemisphere end; the arrow points away from the centre when that end IS the slip (a
  // downward, normal component) and toward it when it is the slip's antipode (an upward, reverse component)
  const slipArrow = (s, len = 7) => {
    const down = s[2] <= 1e-9, p = down ? unit(s) : unit(s.map((x) => -x));
    const h = Math.hypot(p[0], p[1]); if (h < 1e-6) return null;                 // a vertical slip: no direction on the net
    const pl = Math.asin(Math.min(1, -p[2])), tr = Math.atan2(p[0], p[1]), d = (down ? -1 : 1) * len * Math.PI / 180;
    const at = (x) => { const q = Math.max(0, Math.min(Math.PI / 2, pl + x)); return [Math.cos(q) * Math.sin(tr), Math.cos(q) * Math.cos(tr), -Math.sin(q)]; };
    const tip = at(d), side = (w) => { const q = Math.max(0, Math.min(Math.PI / 2, pl + d * 0.55)), t = tr + w; return [Math.cos(q) * Math.sin(t), Math.cos(q) * Math.cos(t), -Math.sin(q)]; };
    return { shaft: [p, tip], head: [side(0.06), tip, side(-0.06)] };
  };

  /**
   * @param {{ layers: object[], colors?: { selected?, ink?, inkMid?, halo? } }} input
   * @returns {{ primitives: object[], stats: Object<string, object>, notes: string[] }}
   *   primitive: { type: 'contour' | 'plane' | 'pole' | 'line' | 'cone', …geometry, style, ref?: { layer, row } }
   */
  function buildScene({ layers, colors = {} }) {
    const C = { selected: '#EC9FFF', ink: '#DDDCDA', inkMid: '#9E9C98', halo: '#101215', ...colors };
    const primitives = [], stats = {}, notes = [];
    let contoured = null;
    for (const L of layers) {
      if (L.visible === false) continue;
      const E = L.elements || {}, col = L.color || C.ink, size = L.size || 4;
      const chosen = new Set(L.selected || []);
      const data = (L.data || []).filter((d) => d && (d.pole || d.dcos));
      const axes = data.map((d) => d.pole || d.dcos);
      const on = (n) => !!E[n]?.on;

      if (on('contours') && axes.length > 2) {
        if (contoured) notes.push(`contours: one set per net — “${L.id}” is under “${contoured}”'s`);
        else {
          contoured = L.id;
          const kamb = (E.contours.method || 'kamb') === 'kamb';
          // Kamb: sigma sets the counting area (E = kσ), contours in σ at 2σ intervals; Fisher: MUD levels
          primitives.push({ type: 'contour', dcos: axes, layer: L.id, options: { method: kamb ? 'kamb' : 'fisher', kambSigma: E.contours.sigma ?? 3,
            levels: E.contours.levels || (kamb ? [2, 4, 6, 8, 10, 12] : [2, 4, 6, 8]), stroke: col, strokeWidth: 0.9 } });
        }
      }
      const isPlane = L.kind === 'planes' || L.kind === 'faults';
      if (isPlane && on('greatCircles')) for (const d of data) if (d.plane) {
        const s = chosen.has(d.row);
        primitives.push({ type: 'plane', dd: d.plane[0], dip: d.plane[1], style: { stroke: s ? C.selected : col, strokeWidth: s ? 1.6 : 0.7, fill: 'none' }, ref: { layer: L.id, row: d.row } });
      }
      if (L.kind === 'smallcircles' && on('circles')) for (const d of data) if (d.line && d.angle > 0) {
        primitives.push({ type: 'cone', trend: d.line[0], plunge: d.line[1], angle: d.angle, style: { stroke: chosen.has(d.row) ? C.selected : col, strokeWidth: 1, fill: 'none', strokeDasharray: 'none' }, ref: { layer: L.id, row: d.row } });
      }
      if (L.kind === 'faults') {
        const F = data.filter((d) => d.pole && d.lineDcos).map((d) => ({ d, ...fault.resolveSense(d.pole, d.lineDcos, d.sense) }));
        if (on('dihedra') && F.some((f) => f.defined)) {
          const D = F.filter((f) => f.defined);
          primitives.push({ type: 'dihedra', planes: D.map((f) => f.d.pole), slips: D.map((f) => f.slip), layer: L.id, style: { stroke: col, strokeWidth: 1.2 } });
        }
        if (on('slip')) for (const f of F) {
          const s = chosen.has(f.d.row), a = f.defined ? slipArrow(f.slip) : null, st = { stroke: s ? C.selected : C.ink, strokeWidth: 1.1, fill: 'none' };
          if (a) { primitives.push({ type: 'curve', points: a.shaft, style: st }); primitives.push({ type: 'curve', points: a.head, style: st }); }
          const [tr, pl] = conversions.dcosToLine(f.d.lineDcos);
          primitives.push({ type: 'line', trend: tr, plunge: pl, dcos: f.d.lineDcos, style: { fill: s ? C.selected : col, r: s ? size / 2 + 2 : size / 2 + 0.5, stroke: s ? C.halo : 'none', strokeWidth: 1 }, ref: { layer: L.id, row: f.d.row } });
        }
        if (on('ptAxes')) for (const f of F) if (f.defined) {
          const { p, t } = fault.ptAxes(f.d.pole, f.slip);
          const [ptr, ppl] = conversions.dcosToLine(p), [ttr, tpl] = conversions.dcosToLine(t);
          primitives.push({ type: 'line', trend: ptr, plunge: ppl, style: { fill: C.halo, stroke: C.ink, strokeWidth: 1, r: 3 }, role: 'P', layer: L.id });
          primitives.push({ type: 'line', trend: ttr, plunge: tpl, style: { fill: C.ink, stroke: 'none', r: 3 }, role: 'T', layer: L.id });
        }
      }
      // statistics on the axes (axial: poles and lines without sense), only when asked for
      if (axes.length >= 2 && (on('mean') || EIGEN.some(on))) {
        const st = stats[L.id] = { n: axes.length };
        if (on('mean')) {
          const axial = E.mean.axial !== false, conf = E.mean.confidence || 0.95;
          const f = statistics.fisherStats(axes, { axial });
          const cone = statistics.confidenceCone(axes, conf, { axial });
          const [tr, pl] = conversions.dcosToLine(f.mean);
          st.mean = { dcos: f.mean, line: [tr, pl], plane: conversions.dcosToPlane(f.mean), kappa: f.kappa, R: f.R, alpha: cone.halfAngle, confidence: conf, axial };
          if (cone.halfAngle > 0) primitives.push({ type: 'cone', trend: tr, plunge: pl, angle: cone.halfAngle, style: { stroke: col, strokeWidth: 1.2, fill: 'none', strokeDasharray: 'none' }, role: 'cone', layer: L.id });
          primitives.push({ type: 'line', trend: tr, plunge: pl, style: { fill: 'none', stroke: C.ink, strokeWidth: 1.6, r: 5 }, role: 'mean', layer: L.id });
        }
        if (axes.length >= 3 && EIGEN.some(on)) {
          const pa = statistics.principalAxes(axes);
          st.eigen = { values: pa.eigenvalues, vectors: pa.eigenvectors, K: pa.K, C: pa.C, P: pa.P, G: pa.G, R: pa.R };
          pa.eigenvectors.forEach((v, j) => {
            const n = j + 1, [tr, pl] = conversions.dcosToLine(v);
            if (on(`v${n}Circle`)) { const [dd, dip] = conversions.dcosToPlane(v); primitives.push({ type: 'plane', dd, dip, style: { stroke: C.inkMid, strokeWidth: 1, fill: 'none', strokeDasharray: '5,3' }, role: `v${n}`, layer: L.id }); }
            if (on(`v${n}Pole`)) primitives.push({ type: 'line', trend: tr, plunge: pl, style: { fill: C.ink, stroke: 'none', r: 3.5 }, role: `v${n}`, layer: L.id });
          });
        }
      }
      // the measurements themselves, on top of the layer's circles
      const points = L.kind === 'lines' ? on('points') : L.kind === 'smallcircles' ? on('axes') : L.kind === 'faults' ? false : on('poles');   // a fault's point is its slickenline, drawn above
      if (points) for (const d of data) {
        const s = chosen.has(d.row), style = { fill: s ? C.selected : col, r: s ? size / 2 + 2 : size / 2 + 0.5, stroke: s ? C.halo : 'none', strokeWidth: 1 };
        if (d.plane) primitives.push({ type: 'pole', dd: d.plane[0], dip: d.plane[1], dcos: d.pole || conversions.planeToDcos(d.plane[0], d.plane[1]), style, ref: { layer: L.id, row: d.row } });
        else if (d.line) primitives.push({ type: 'line', trend: d.line[0], plunge: d.line[1], dcos: d.dcos || conversions.lineToDcos(d.line[0], d.line[1]), style, ref: { layer: L.id, row: d.row } });
      }
    }
    return { primitives, stats, notes };
  }

  /**
   * A scene onto a bearing Stereonet, and the pick table that maps what was drawn back to (layer, row).
   * The look comes from a theme object (tokens the host resolves), not from CSS, so the same call draws
   * into an app, a figure frame or an offscreen export.
   * @param {{ primitives: object[] }} scene
   * @param {{ size: number, padding?: number, projection?: string, hemisphere?: string, rotation?: number[] | null,
   *           center?: [number, number] | null, graticule?: number, classPrefix?: string,
   *           theme?: { background?, rim?, grid?, cardinals?, font? } }} options
   * @returns {{ net: object, svg: SVGSVGElement | null, picks: Array<{ x: number, y: number, ref: { layer, row } }> }}
   *   svg is null where there is no DOM (net.svg() gives the markup string)
   */
  function makeNet(scene, options) {
    const t = options.theme || {};
    const net = new Stereonet({
      size: options.size, padding: options.padding ?? 26, projection: options.projection || 'equal-area',
      hemisphere: options.hemisphere || 'lower', gridSpacing: options.graticule || 10, classPrefix: options.classPrefix ?? 'gsn',
      ...(options.rotation ? { rotation: options.rotation } : options.center ? { center: options.center } : {}),
      style: {
        background: t.background || '#101215',
        primitive: { stroke: t.rim || '#8A8884', strokeWidth: 1.4, fill: 'none' },
        grid: { stroke: t.grid || '#2A2E33', strokeWidth: 0.5, majorStroke: t.grid || '#2A2E33', majorStrokeWidth: 0.7 },
        cardinals: { fill: t.cardinals || '#9E9C98', fontSize: 12, fontFamily: t.font || 'monospace', offset: 14 },
      },
    });
    const picks = [];
    for (const p of scene.primitives || []) {
      if (p.type === 'contour') net.contour(p.dcos, p.options);
      else if (p.type === 'plane') net.plane(p.dd, p.dip, p.style);
      else if (p.type === 'cone') net.cone(p.trend, p.plunge, p.angle, p.style);
      else if (p.type === 'pole') net.pole(p.dd, p.dip, p.style);
      else if (p.type === 'line') net.line(p.trend, p.plunge, p.style);
      else if (p.type === 'curve') net.curve(p.points, p.style);
      else if (p.type === 'dihedra' && !options.rotation && !options.center) {   // the field is computed in the unrotated projection
        net.contour(p.planes, { grid: fault.dihedraGrid(p.planes, p.slips, { projection: options.projection || 'equal-area', gridSize: 64 }), levels: [0], stroke: p.style.stroke, strokeWidth: p.style.strokeWidth });
      }
      if (p.ref && p.dcos && (p.type === 'pole' || p.type === 'line')) { const q = net.project(p.dcos); picks.push({ x: q.x, y: q.y, ref: p.ref }); }
    }
    return { net, picks };
  }

  function renderScene(scene, options) {
    const { net, picks } = makeNet(scene, options);
    let svg = null;
    if (typeof document !== 'undefined') { svg = net.element(); net.render(); }
    return { net, svg, picks };
  }

  /**
   * A scene onto any Canvas-2D-shaped context (a canvas, compo's vector PDF page) at (x, y), size `size`
   * in that context's units. The net is laid out at a nominal 400 units and scaled, so its line weights
   * keep their proportions on paper.
   */
  function drawScene(ctx, scene, { x = 0, y = 0, size, ...options }) {
    const N = 400, { net } = makeNet(scene, { ...options, size: N });
    ctx.save(); ctx.translate(x, y); ctx.scale(size / N, size / N);
    net.draw(ctx, { x: 0, y: 0, size: N });
    ctx.restore();
  }

  /**
   * A frame kind for @gcu/compo (compo.registerKind('stereonet', core.compoKind())). The frame carries its
   * scene as plain data — content: { scene, net: { projection, hemisphere, center, graticule }, theme? } —
   * so a saved figure redraws exactly what was on the net, as vectors in the PDF.
   */
  function compoKind({ theme = PAPER } = {}) {
    return {
      label: 'stereonet',
      describe: (f) => `stereonet${f.content?.title ? ' · ' + f.content.title : ''}`,
      draw(ctx, box, frame) {
        const c = frame.content || {}, size = Math.min(box[2], box[3]);
        drawScene(ctx, c.scene || { primitives: [] }, { x: box[0] + (box[2] - size) / 2, y: box[1] + (box[3] - size) / 2, size, ...(c.net || {}), theme: { ...theme, ...(c.theme || {}) } });
      },
    };
  }

  return { buildScene, renderScene, drawScene, compoKind, nearestPick };
}

/** a net's look on paper (figures): white ground, dark ink */
const PAPER = { background: '#FFFFFF', rim: '#232322', grid: '#D3D1CD', cardinals: '#232322', font: 'sans-serif' };

// ── src/select.js ──

// @gcu/stereonet — SELECTIONS IN ATTITUDE SPACE. A shape lives on the sphere, not on the screen, so it keeps
// meaning the same measurements when the net rotates or changes projection. All tests are AXIAL: a pole and
// its antipode are the same measurement. Pure vector maths, no bearing needed.
//
// Shapes (direction cosines, x = E, y = N, z = Up):
//   { type: 'cone',    axis: [x,y,z], angle }       within `angle` degrees of the axis
//   { type: 'band',    pole: [x,y,z], width }       within `width` degrees of the great circle whose pole is `pole`
//   { type: 'polygon', vertices: [[x,y,z], …] }     inside a spherical polygon with great-circle edges (a lasso);
//                                                   it must fit within a hemisphere (any lasso drawn on a net does)

const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** the great circle through two directions, as its pole (null if they coincide or are antipodal) */
function greatCircleThrough(a, b) {
  const c = cross(norm(a), norm(b)), l = Math.hypot(...c);
  return l < 1e-9 ? null : [c[0] / l, c[1] / l, c[2] / l];
}

/** the angle between two axes, degrees (0–90) */
function axialAngle(a, b) {
  return Math.acos(Math.min(1, Math.abs(dot(norm(a), norm(b))))) / D2R;
}

// a polygon's test, prepared once: a gnomonic projection about the polygon's centre maps its great-circle
// edges to straight lines, so "inside" is a plain 2D point-in-polygon there
function preparePolygon(vertices) {
  const V = vertices.map(norm);
  const s = V.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]);
  const c = norm(s);
  const u = norm(cross(Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], c)), w = cross(c, u);
  const flat = (d) => { const k = dot(d, c); return k > 1e-9 ? [dot(d, u) / k, dot(d, w) / k] : null; };
  const P = V.map(flat);
  if (P.some((q) => !q)) return () => false;           // wider than a hemisphere: not a lasso drawn on a net
  return (d) => {
    const q = flat(dot(d, c) < 0 ? [-d[0], -d[1], -d[2]] : d);   // axial: test the end on the polygon's side
    if (!q) return false;
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > q[1]) !== (yj > q[1]) && q[0] < (xj - xi) * (q[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

/** a shape → a test (dcos → boolean), prepared once for many measurements */
function shapeTest(shape) {
  if (shape.type === 'cone') { const a = norm(shape.axis), c = Math.cos(shape.angle * D2R); return (d) => Math.abs(dot(norm(d), a)) >= c - 1e-12; }
  if (shape.type === 'band') { const p = norm(shape.pole), s = Math.sin(shape.width * D2R); return (d) => Math.abs(dot(norm(d), p)) <= s + 1e-12; }
  if (shape.type === 'polygon') { if (!shape.vertices || shape.vertices.length < 3) return () => false; return preparePolygon(shape.vertices); }
  throw new Error(`unknown selection shape “${shape.type}”`);
}

/**
 * The rows of a layer's data inside a shape: [{ row, pole?|dcos? }] → rows. A plane is tested by its pole,
 * a line by its direction.
 */
function rowsInShape(data, shape) {
  const t = shapeTest(shape), out = [];
  for (const d of data) { const v = d && (d.pole || d.dcos); if (v && t(v)) out.push(d.row); }
  return out;
}

/** points along a shape's outline, for drawing it on a net (n per edge / around) */
function shapeOutline(shape, n = 72) {
  const ring = (axis, ang) => {
    const a = norm(axis), u = norm(cross(Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], a)), w = cross(a, u), c = Math.cos(ang * D2R), s = Math.sin(ang * D2R);
    const pts = []; for (let i = 0; i <= n; i++) { const t = 2 * Math.PI * i / n; pts.push([c * a[0] + s * (Math.cos(t) * u[0] + Math.sin(t) * w[0]), c * a[1] + s * (Math.cos(t) * u[1] + Math.sin(t) * w[1]), c * a[2] + s * (Math.cos(t) * u[2] + Math.sin(t) * w[2])]); }
    return pts;
  };
  if (shape.type === 'cone') return [ring(shape.axis, shape.angle)];
  if (shape.type === 'band') return [ring(shape.pole, 90 - shape.width), ring(shape.pole, 90 + shape.width)];
  if (shape.type === 'polygon') {
    const V = shape.vertices.map(norm), pts = [];
    for (let i = 0; i < V.length; i++) {
      const a = V[i], b = V[(i + 1) % V.length], m = 12;
      for (let k = 0; k < m; k++) { const t = k / m; pts.push(norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])); }
    }
    pts.push(V[0]);
    return [pts];
  }
  return [];
}

// ── src/cell.js ──

// @gcu/stereonet — declarative, interactive, reactive stereonet cells.
//
// EXTENSION_SPEC §3.1 cell type, notebook context. A `/// stereonet` cell's
// SOURCE is structural-geology measurements + a few directives; its OUTPUT is an
// interactive equal-area / equal-angle net (drag to rotate); and it DEFINES a
// scope handle that downstream cells consume reactively — edit a measurement and
// the DAG re-runs the dependents.
//
// The engine is @gcu/bearing, loaded at execute time via the cell context's
// load() (so `install("@gcu/bearing")` once makes it offline; no vendoring).
//
// Cell format (one statement per line; `;` or `//` start a comment):
//   name <var>                 scope name this cell defines (default: stereonet)
//   proj equal-area|equal-angle
//   view <trend> <plunge>      rotate the net to this centre
//   g <group>                  subsequent items join this group
//   plane <dipDir> <dip> [#rgb]
//   pole  <dipDir> <dip> [#rgb]
//   line  <trend>  <plunge> [#rgb]
//   contour                    density-contour all poles/lines (≥3)

const NAME_RE = /^\s*name\s+([A-Za-z_]\w*)/m;
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b/;

function exportName(code) {
  const m = NAME_RE.exec(code);
  return m ? m[1] : 'stereonet';
}

// Parse the mini-format into a render spec. Pure + side-effect free.
function parseCell(code) {
  const spec = { projection: 'equal-area', size: 520, view: null, name: 'stereonet', contour: false, items: [] };
  let group = null;
  for (const raw of code.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;
    const tok = line.split(/\s+/);
    const head = tok[0].toLowerCase();
    const num = (i) => parseFloat(tok[i]);
    const color = (line.match(COLOR_RE) || [])[0];
    switch (head) {
      case 'name': spec.name = tok[1] || spec.name; break;
      case 'proj': case 'projection':
        spec.projection = /angle|wulff/i.test(tok[1] || '') ? 'equal-angle' : 'equal-area'; break;
      case 'view': spec.view = [num(1), num(2)]; break;
      case 'g': case 'group': group = tok.slice(1).join(' ') || null; break;
      case 'contour': spec.contour = true; break;
      case 'plane': case 'pole': case 'line':
        spec.items.push({ kind: head, a: num(1), b: num(2), color, group }); break;
      default: break; // ignore unknown lines (forward-compatible)
    }
  }
  return spec;
}

// Pointer-driven arcball rotation on the live SVG (no cell re-run — DOM only).
function wireArcball(el, sn, mat3) {
  el.style.cursor = 'grab';
  el.style.touchAction = 'none';
  let cur = null;
  const toSvg = (e) => {
    const r = el.getBoundingClientRect();
    const k = sn.size / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };
  el.addEventListener('pointerdown', (e) => {
    cur = toSvg(e); el.setPointerCapture?.(e.pointerId); el.style.cursor = 'grabbing'; e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const n = toSvg(e);
    const arc = sn.arcball(cur.x, cur.y, n.x, n.y);
    const R = sn.rotation ? mat3.multiply(arc, sn.rotation) : arc;
    sn.setRotation(mat3.orthonormalize(R));
    sn.updateContours(); sn.render();
    cur = n;
  });
  const end = () => { cur = null; el.style.cursor = 'grab'; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// ── editor highlighting ──────────────────────────────────────────────────
// A per-line tokenizer for the mini-format, consumed by cm6's StreamLanguage
// adapter (src/js/cm6.js makeStreamLang). Tokens are { type, text } and must
// TILE each line contiguously (the stream advances by text.length); whitespace
// and unstyled runs carry type ''. Types map to @lezer tags via cm6's table:
// dir/kw→keyword, num→number, str→string, id→variable, cmt→comment.
const DIRECTIVES = new Set([
  'name', 'proj', 'projection', 'view', 'g', 'group', 'plane', 'pole', 'line', 'contour',
]);

function _tokLine(line, out) {
  const n = line.length;
  let i = 0;
  let firstWord = true;
  while (i < n) {
    const c = line[i];
    // Comment to end of line: `;` or `//`.
    if (c === ';' || (c === '/' && line[i + 1] === '/')) {
      out.push({ type: 'cmt', text: line.slice(i) });
      return;
    }
    // Whitespace run.
    if (/\s/.test(c)) {
      let j = i + 1; while (j < n && /\s/.test(line[j])) j++;
      out.push({ type: '', text: line.slice(i, j) }); i = j; continue;
    }
    // Hex colour (#rgb..#rrggbbaa).
    if (c === '#') {
      let j = i + 1; while (j < n && /[0-9a-fA-F]/.test(line[j])) j++;
      out.push({ type: 'str', text: line.slice(i, j) }); i = j; continue;
    }
    // Word — the first word on a line is the directive head.
    const wm = /^[A-Za-z_][\w-]*/.exec(line.slice(i));
    if (wm) {
      const w = wm[0];
      out.push({ type: firstWord && DIRECTIVES.has(w.toLowerCase()) ? 'dir' : 'id', text: w });
      i += w.length; firstWord = false; continue;
    }
    // Number (trend/plunge/dip — int or decimal, optional sign).
    const nm = /^[-+]?(?:\d+\.?\d*|\.\d+)/.exec(line.slice(i));
    if (nm) { out.push({ type: 'num', text: nm[0] }); i += nm[0].length; continue; }
    // Any other single char (unstyled).
    out.push({ type: '', text: c }); i++;
  }
}

// tokenize(code) → contiguous { type, text } tiles. cm6 calls it per line
// (stream.string); robust for whole-source calls too (tests).
function stereonetTokenize(code) {
  const out = [];
  const lines = String(code).split('\n');
  for (let i = 0; i < lines.length; i++) {
    _tokLine(lines[i], out);
    if (i < lines.length - 1) out.push({ type: '', text: '\n' });
  }
  return out;
}

// EXTENSION_SPEC §3.1 — the one name this cell contributes to downstream scope.
function stereonetParseNames(code) {
  return new Set([exportName(code)]);
}

// Self-contained data (no upstream references in the format) → no DAG in-edges.
function stereonetFindUses() {
  return new Set();
}

// EXTENSION_SPEC §3.1 — execute(code, upstream, cell). Output via cell._ctx.display;
// scope populated by the returned { defines }.
async function stereonetExecute(code, _upstream, cell) {
  const ctx = cell?._ctx;
  if (!ctx) throw new Error('stereonet: no cell context');

  let B;
  try {
    B = await ctx.load('@gcu/bearing');
  } catch (e) {
    throw new Error("stereonet: couldn't load @gcu/bearing — run install(\"@gcu/bearing\") once, then re-run.");
  }
  const { Stereonet, mat3, conversions, statistics } = B;

  const spec = parseCell(code);
  const sn = new Stereonet({ projection: spec.projection, size: spec.size, classPrefix: 'sn' });
  const el = sn.element();
  wireArcball(el, sn, mat3);

  const dcosOf = (it) => it.kind === 'line'
    ? conversions.lineToDcos(it.a, it.b) : conversions.planeToDcos(it.a, it.b);

  // Full dataset for the downstream handle — view-independent (the in-cell
  // sliders/toggles below are a VIEW concern; the handle always carries every
  // measurement so downstream stats don't change when you hide a layer).
  const groups = {};
  const all = [];
  for (const it of spec.items) { const d = dcosOf(it); (groups[it.group || 'all'] ||= []).push(d); all.push(d); }

  // Per-group visibility (toggles) — preserves the live rotation on redraw.
  const groupNames = [...new Set(spec.items.map((it) => it.group || 'all'))];
  const hasNamedGroups = spec.items.some((it) => it.group);
  const visible = {};
  for (const g of groupNames) visible[g] = true;

  function redraw() {                       // re-add visible items; keep rotation
    sn.clear();
    if (typeof sn.clearContours === 'function') sn.clearContours();
    const shown = [];
    for (const it of spec.items) {
      if (!visible[it.group || 'all']) continue;
      const style = it.color ? { stroke: it.color, fill: it.color } : {};
      if (it.kind === 'plane') sn.plane(it.a, it.b, style);
      else if (it.kind === 'pole') sn.pole(it.a, it.b, style);
      else if (it.kind === 'line') sn.line(it.a, it.b, style);
      shown.push(dcosOf(it));
    }
    if (spec.contour && shown.length >= 3) sn.contour(shown);
    sn.render();
  }
  const view = { trend: spec.view ? spec.view[0] : 0, plunge: spec.view ? spec.view[1] : 90 };
  function applyView() {                    // rotate to the sliders (view change)
    sn.setCenter(view.trend, view.plunge);
    if (typeof sn.updateContours === 'function') sn.updateContours();
    sn.render();
  }

  // In-cell view widgets (DOM-only via onInput/onChange — no cell re-run, like
  // the arcball). Values persist across re-execution via the cell's widget store.
  const tv = ctx.ui.slider('view trend', view.trend, { min: 0, max: 360, step: 5, onInput: (v) => { view.trend = +v; applyView(); } });
  const pv = ctx.ui.slider('view plunge', view.plunge, { min: 0, max: 90, step: 5, onInput: (v) => { view.plunge = +v; applyView(); } });
  view.trend = +tv; view.plunge = +pv;
  if (hasNamedGroups) {
    for (const g of groupNames) {
      const on = ctx.ui.checkbox('show ' + g, true, { onChange: (v) => { visible[g] = (v === true || v === 'true'); redraw(); } });
      visible[g] = (on === true || on === 'true');
    }
  }

  redraw();        // add items (honours persisted toggle state)
  applyView();     // set the initial / persisted view
  ctx.display(el);

  // The reactive scope handle downstream cells consume (full dataset).
  const stats = all.length >= 2
    ? { ...statistics.principalAxes(all), fisher: statistics.fisherStats(all) }
    : null;
  const handle = { stereonet: sn, element: el, dcos: all, groups, stats };

  ctx.display(`${spec.name}: ${all.length} measurement${all.length === 1 ? '' : 's'}`
    + `${spec.contour ? ' · contoured' : ''} · ${spec.projection}`);

  return { defines: { [spec.name]: handle } };
}

// EXTENSION_SPEC §2.3 guard — register once per page (dev hot-reload / re-load safe).
if (typeof window !== 'undefined' && !window._cellTypes?.['stereonet']) {
  const register = window.auditable?.registerExtension;
  if (register) {
    register({
      name: '@gcu/stereonet',
      version: '0.1.0',
      description: 'Declarative, interactive, reactive stereonet cells (structural geology).',
      pluginUrl: '@gcu/stereonet',
      cellType: {
        name: 'stereonet',
        label: 'Stereonet',
        color: 'var(--au-info)',
        shortcut: 's',
        editDebounce: 250,
        capabilities: { executable: true, definesScope: true, hasOutput: true, hasEditor: true, builtin: false },
        parseNames: stereonetParseNames,
        findUses: stereonetFindUses,
        execute: stereonetExecute,
        tokenize: stereonetTokenize,
      },
    });
  }
}

// ── src/main.js ──

// @gcu/stereonet — module manifest (build order). One package, the GCU stack's stereonet:
//   format.js — attitudes as text (planes 045/72, lines 045→32)
//   core.js   — stereonetCore(bearing): layers → scene (primitives + statistics) → a bearing net, picking
//   select.js — selections in attitude space (cone, band, lasso polygon): rotation-proof, axial
//   cell.js   — the notebook's `/// stereonet` cell (registers itself in a notebook)
// No static imports anywhere: bearing is injected (core) or loaded at run time (cell).

export {
  formatPlane,
  formatLine,
  nearestPick,
  stereonetCore,
  PAPER,
  greatCircleThrough,
  axialAngle,
  shapeTest,
  rowsInShape,
  shapeOutline,
  stereonetTokenize,
  stereonetParseNames,
  stereonetFindUses,
  stereonetExecute,
  parseCell,
};
