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
export function nearestPick(picks, x, y, radius = 8) {
  let best = null, bd = radius;
  for (const k of picks) { const d = Math.hypot(k.x - x, k.y - y); if (d < bd) { bd = d; best = k; } }
  return best;
}

/**
 * @param {object} B - the @gcu/bearing module (needs statistics, conversions, Stereonet)
 * @returns {{ buildScene: Function, renderScene: Function, nearestPick: Function }}
 */
export function stereonetCore(B) {
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
        if (contoured) notes.push(`contours: one set per net — “${L.id}” isn’t contoured; the contours are “${contoured}”’s`);
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
      // labels beside each measurement's point (the pole, the line, a fault's slickenline): d.label, else the row
      // number. Drawn whether or not the points are, so a net of great circles can still be read off.
      if (on('labels')) for (const d of data) {
        const at = L.kind === 'faults' && d.lineDcos ? conversions.dcosToLine(d.lineDcos) : d.plane ? conversions.dcosToLine(d.pole || conversions.planeToDcos(d.plane[0], d.plane[1])) : d.line;
        if (!at) continue;
        primitives.push({ type: 'text', trend: at[0], plunge: at[1], content: d.label ?? String(d.row + 1),
          style: { fill: chosen.has(d.row) ? C.selected : col, fontSize: 9, dx: 5, dy: -4, textAnchor: 'start' }, layer: L.id });
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
      else if (p.type === 'text') net.text(p.trend, p.plunge, p.content, p.style);
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
export const PAPER = { background: '#FFFFFF', rim: '#232322', grid: '#D3D1CD', cardinals: '#232322', font: 'sans-serif' };
