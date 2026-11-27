// wuffle desk — the MEASURE tool (after OpenStereo 2's; the maths in measure.js). With "measure" chosen in a
// net's tool strip, a drag from one direction to another draws, live:
//   drag (left button)     the arc A→B, the whole great circle through them (dotted) and the arcs from A and B
//                          to its pole (dotted) — OS2's measurelinegc
//   ⇧-drag (middle button) the small circle on AB as its diameter
//   ⌥-drag (right button)  the small circle about A, through B
// and reads the angle and the attitudes in a box on the net. The last measurement stays drawn (OS2 cleared it
// on release) with buttons that add it to the project as data — the plane, its pole, the small circle, its
// axis, or the two ends — drawn on that net. Esc clears it; it redraws with the net (a rotation keeps it on
// its directions).

import { measureOf, arcPoints, circlePoints, describeMeasure, measureOffers, deriveMeasure } from './measure.js';

const NS = 'http://www.w3.org/2000/svg';
const OFFER = { plane: '+ plane', pole: '+ pole', circle: '+ small circle', axis: '+ axis', ends: '+ the two ends' };

// A right CLICK (no drag) opens the measure menu: the last measurement's actions, then the net's menu.
// "Measure from here" (startFrom) fixes A; the arc follows the pointer and the next click sets B.
export function createMeasure({ project: p, select, onStatus = () => {} }) {
  let menuHook = null, pending = null;              // pending: { view, a } — measuring from a fixed A
  const last = new Map();                           // view → its measurement
  const boxes = new Map();                          // view → its readout box

  // a run of directions → an SVG path on this net; a point on the upper hemisphere breaks it (the net shows
  // the lower one), as does a jump across the net
  const pathOf = (view, pts) => {
    let d = '', prev = null;
    for (const v of pts) {
      const q = view.net.project(v);
      if (q.upper) { prev = null; continue; }
      const jump = prev && Math.hypot(q.x - prev.x, q.y - prev.y) > view.net.size * 0.4;
      d += `${!prev || jump ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; prev = q;
    }
    return d;
  };
  function draw(view) {
    const svg = view.stage.querySelector('svg'); if (!svg || !view.net) return;
    svg.querySelector('.wmeas-g')?.remove();
    const m = last.get(view); if (!m) return;
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'wmeas-g');
    const add = (cls, pts) => { const d = pathOf(view, pts); if (!d) return; const e = document.createElementNS(NS, 'path'); e.setAttribute('class', cls); e.setAttribute('d', d); g.append(e); };
    if (m.mode === 'gc' && m.pole) {
      add('wmeas-gc', circlePoints(m.pole, 90));                    // the whole great circle (dotted)
      add('wmeas-gc', arcPoints(m.a, m.pole)); add('wmeas-gc', arcPoints(m.b, m.pole));
      const q = view.net.project(m.pole);
      if (!q.upper) { const c = document.createElementNS(NS, 'path'); c.setAttribute('class', 'wmeas-pole'); c.setAttribute('d', `M${q.x - 4},${q.y}h8M${q.x},${q.y - 4}v8`); g.append(c); }
    } else if (m.axis) add('wmeas-sc', circlePoints(m.axis, m.radius));
    add('wmeas-arc', arcPoints(m.a, m.b));                          // the measured arc, solid
    for (const v of [m.a, m.b]) { const q = view.net.project(v); if (q.upper) continue; const c = document.createElementNS(NS, 'circle'); c.setAttribute('class', 'wmeas-end'); c.setAttribute('cx', q.x.toFixed(1)); c.setAttribute('cy', q.y.toFixed(1)); c.setAttribute('r', '3'); g.append(c); }
    svg.append(g);
  }
  function readout(view, live) {
    const box = boxes.get(view), m = last.get(view); if (!box) return;
    box.replaceChildren();
    if (!m) { box.hidden = true; return; }
    box.hidden = false;
    const t = document.createElement('div'); t.className = 'wmeas-txt'; t.textContent = describeMeasure(m); box.append(t);
    if (live) return;
    const row = document.createElement('div'); row.className = 'wmeas-acts';
    for (const what of measureOffers(m)) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = OFFER[what]; b.dataset.offer = what;
      b.title = what === 'ends' ? 'the two directions you measured between, as lines' : `add the ${what === 'circle' ? 'small circle' : what} to the project, drawn on this net`;
      b.onclick = () => {
        try {
          const id = p.batch('measure', () => { const x = deriveMeasure(p, m, what); p.addLayer(view.id, x); return x; });
          onStatus(`→ ${p.dataset(id).name}, drawn on ${p.diagram(view.id)?.name || 'the net'}`);
        } catch (e) { onStatus(e.message); }
      };
      row.append(b);
    }
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'clear the measurement (Esc)'; x.onclick = () => clear(view);
    row.append(x); box.append(row);
  }
  function clear(view) { last.delete(view); draw(view); readout(view); }

  function attach(view) {
    const box = document.createElement('div'); box.className = 'wmeas'; box.hidden = true; view.el.append(box); boxes.set(view, box);
    view.drawn.add((v) => draw(v));                                 // survives the net's redraws (and rotations)
    let drag = null;
    const dirAt = (e) => { const q = view.svgPoint(e); return q && view.net ? view.net.unproject(q.x, q.y) : null; };
    const active = () => select.tool === 'measure';
    // the right button measures (a drag); a right CLICK opens the measure menu. Browsers fire contextmenu on the
    // press (Linux, macOS, headless) or on the release (Windows): the menu opens on whichever of the press's
    // contextmenu and the release comes SECOND — opened first, the contextmenu that follows would close it.
    // The keyboard's menu key (contextmenu with no button down) opens it at once.
    let rightClick = false;
    view.stage.addEventListener('contextmenu', (e) => {
      if (!active()) return;
      e.preventDefault();
      if (drag && drag.button === 2 && !drag.moved) { drag.menu = true; return; }   // still pressed: wait for the release
      if (rightClick) { rightClick = false; openMenu(view, e); return; }               // released already: now
      if (!drag) openMenu(view, e);
    });
    view.stage.addEventListener('pointerdown', (e) => {
      if (!active() || !view.net) return;
      const a = dirAt(e); if (!a) return;
      e.preventDefault();
      if (pending && pending.view === view && e.button === 0) {   // "measure from here": this click is B
        const m = measureOf(pending.a, a, 'gc'); pending = null;
        if (m.angle >= 0.05) { last.set(view, m); draw(view); readout(view, false); onStatus(describeMeasure(m)); } else clear(view);
        return;
      }
      view.stage.setPointerCapture(e.pointerId);
      const mode = e.button === 1 || (e.button === 0 && e.shiftKey) ? 'diameter' : e.button === 2 || (e.button === 0 && e.altKey) ? 'about' : 'gc';
      drag = { a, mode, button: e.button, sx: e.clientX, sy: e.clientY, moved: false };
    });
    view.stage.addEventListener('pointermove', (e) => {
      if (!drag && pending && pending.view === view && active()) {   // the arc from A follows the pointer
        const b = dirAt(e); if (!b) return;
        const m = measureOf(pending.a, b, 'gc'); last.set(view, m); draw(view); readout(view, true); onStatus(`${describeMeasure(m)} — click to set B (Esc cancels)`);
        return;
      }
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      const b = dirAt(e); if (!b) return;
      const m = measureOf(drag.a, b, drag.mode);
      last.set(view, m); draw(view); readout(view, true); onStatus(describeMeasure(m));
    });
    const end = (e) => {
      if (!drag) return;
      const was = drag; drag = null;
      try { view.stage.releasePointerCapture(e.pointerId); } catch { /* released */ }
      if (was.button === 2 && !was.moved && e.type === 'pointerup') { if (was.menu) openMenu(view, e); else rightClick = true; return; }   // a right CLICK
      if (!was.moved) { if (!last.get(view)) return; }
      const m = last.get(view);
      if (m && m.angle < 0.05) { clear(view); return; }             // a click, not a measurement
      readout(view, false);
    };
    view.stage.addEventListener('pointerup', end);
    view.stage.addEventListener('pointercancel', end);
  }
  // the measure menu: this tool's own items first, then the net's (selection, the net, the picture)
  function openMenu(view, e) {
    const m = last.get(view), offers = m ? measureOffers(m) : [];
    const head = [];
    if (m) {
      head.push({ label: describeMeasure(m).split('\n')[0], disabled: true });
      for (const what of offers) head.push({ label: `Add ${OFFER[what].replace(/^\+ /, 'the ')}`, action: 'm:' + what });
      head.push({ label: 'Copy the reading', action: 'm:copy' }, { label: 'Clear the measurement', action: 'm:clear', shortcut: 'Esc' });
    } else head.push({ label: 'nothing measured yet — drag between two directions', disabled: true });
    head.push({ label: 'Measure from here', action: 'm:from', title: 'A here; the next click is B' });
    head.push({ label: 'How to measure', children: [
      { label: 'drag: the arc and its great circle', disabled: true },
      { label: '⇧-drag or the middle button: the small circle on that diameter', disabled: true },
      { label: '⌥-drag or the right button: the small circle about A', disabled: true } ] });
    const here = dirAt(view, e);
    const onAction = async (a) => {
      if (!a.startsWith('m:')) return false;
      const k = a.slice(2);
      if (k === 'clear') clear(view);
      else if (k === 'copy') { try { await navigator.clipboard.writeText(describeMeasure(m)); onStatus('copied the reading'); } catch { onStatus(describeMeasure(m)); } }
      else if (k === 'from') { if (here) startFrom(view, here); }
      else {
        try { const id = p.batch('measure', () => { const x = deriveMeasure(p, m, k); p.addLayer(view.id, x); return x; }); onStatus(`→ ${p.dataset(id).name}, drawn on ${p.diagram(view.id)?.name || 'the net'}`); }
        catch (err) { onStatus(err.message); }
      }
      return true;
    };
    if (menuHook) menuHook(view, e, { head, onAction });
  }
  function dirAt(view, e) { const q = view.svgPoint(e); return q && view.net ? view.net.unproject(q.x, q.y) : null; }
  /** "measure from here": A fixed at `a`; the arc follows the pointer; the next click sets B */
  function startFrom(view, a) { pending = { view, a }; onStatus('measuring from here — move to B and click (Esc cancels)'); }
  function detach(view) { last.delete(view); boxes.get(view)?.remove(); boxes.delete(view); }
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.body.classList.contains('desk') || /^(INPUT|TEXTAREA)$/.test(e.target?.tagName)) return;
    if (pending) { const v = pending.view; pending = null; clear(v); return; }
    for (const v of [...last.keys()]) clear(v);
  });
  return { attach, detach, measurementOf: (v) => last.get(v) || null, clear, startFrom, setMenu: (fn) => { menuHook = fn; }, get pending() { return pending; } };
}
