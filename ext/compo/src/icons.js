// The editor's icons: line drawings on a 24 × 24 grid, stroked in currentColor (2 px, round caps
// and joins), so a light or a dark theme colours them with the text. Built with createElementNS —
// no markup strings, nothing fetched, nothing that a strict CSP or Trusted Types would refuse.
// A host can use them (and iconButton) for its own buttons, so one toolbar speaks one language.
//
// ICONS[name] = [[tag, attrs], …]. iconSvg(name | spec) → <svg>. iconButton({ icon, label, keys,
// title, run, cls }) → a <button> holding the icon, with label as its aria-label and
// "label · keys — title" as its tooltip.

const P = (d) => ['path', { d }];
const R = (x, y, width, height, rx = 1) => ['rect', { x, y, width, height, rx }];
const FILL = { fill: 'currentColor', stroke: 'none' };
const PAGE = P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z');
const FOLD = P('M14 2v6h6');

export const ICONS = {
  undo: [P('M9 14 4 9l5-5'), P('M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
  redo: [P('m15 14 5-5-5-5'), P('M20 9H9.5a5.5 5.5 0 0 0 0 11H13')],
  // the page's rulers: one along the top, one down the left, with ticks
  rulers: [P('M3 3h18v5H8v13H3Z'), P('M12 3v2.5M16 3v2.5M20 3v2.5M3 12h2.5M3 16h2.5M3 20h2.5')],
  // frames
  view: [P('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z'), P('M3.3 7 12 12l8.7-5'), P('M12 22V12')],
  // a legend: three swatches and their words
  legend: [['rect', { x: 2.5, y: 4, width: 5, height: 4, rx: 0.5, ...FILL }], ['rect', { x: 2.5, y: 10, width: 5, height: 4, rx: 0.5, ...FILL }], ['rect', { x: 2.5, y: 16, width: 5, height: 4, rx: 0.5, ...FILL }], P('M11 6h10M11 12h10M11 18h7')],
  // a scale bar: a line with end ticks and divisions
  scalebar: [P('M3 15h18'), P('M3 9v6M21 9v6M12 11v4M7.5 13v2M16.5 13v2')],
  north: [['path', { d: 'M12 2.5 6.5 20.5 12 16.5Z', ...FILL }], P('M12 2.5l5.5 18-5.5-4-5.5 4Z')],
  text: [P('M4 7V4h16v3'), P('M12 4v16'), P('M9 20h6')],
  shape: [R(3, 3, 11, 11, 1), ['circle', { cx: 15.5, cy: 15.5, r: 5.5 }]],
  qr: [R(3, 3, 7, 7, 1), R(14, 3, 7, 7, 1), R(3, 14, 7, 7, 1), ['rect', { x: 5.5, y: 5.5, width: 2, height: 2, ...FILL }], ['rect', { x: 16.5, y: 5.5, width: 2, height: 2, ...FILL }], ['rect', { x: 5.5, y: 16.5, width: 2, height: 2, ...FILL }], P('M14 14h3v3M21 14v7h-4M14 18v3')],
  label: [R(11, 3, 10, 7), P('M14 6.5h4'), P('M11 10l-5 7'), ['circle', { cx: 5, cy: 18.5, r: 1.6, ...FILL }]],
  image: [R(3, 3, 18, 18, 2), ['circle', { cx: 9, cy: 9, r: 2 }], P('m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21')],
  titleblock: [R(3, 3, 18, 18), P('M10 21v-8h11'), P('M10 17h11'), P('M15.5 13v4')],
  table: [R(3, 4, 18, 16), P('M3 9.5h18M3 15h18M9 9.5V20')],
  // align: the line the frames line up on, and two frames
  'align-left': [P('M3.5 3v18'), R(7, 5.5, 13, 5), R(7, 13.5, 8, 5)],
  'align-hcenter': [P('M12 2.5v3M12 10.5v3M12 18.5v3'), R(4.5, 5.5, 15, 5), R(8, 13.5, 8, 5)],
  'align-right': [P('M20.5 3v18'), R(4, 5.5, 13, 5), R(9, 13.5, 8, 5)],
  'align-top': [P('M3 3.5h18'), R(5.5, 7, 5, 13), R(13.5, 7, 5, 8)],
  'align-vcenter': [P('M2.5 12h3M10.5 12h3M18.5 12h3'), R(5.5, 4.5, 5, 15), R(13.5, 8, 5, 8)],
  'align-bottom': [P('M3 20.5h18'), R(5.5, 4, 5, 13), R(13.5, 9, 5, 8)],
  // distribute: equal gaps between the outer two
  'dist-h': [P('M3.5 3v18M20.5 3v18'), R(9, 6, 6, 12), P('M5.5 12h1.5M17 12h1.5')],
  'dist-v': [P('M3 3.5h18M3 20.5h18'), R(6, 9, 12, 6), P('M12 5.5V7M12 17v1.5')],
  // match size: as wide / as tall / as big as the first
  'same-w': [P('M3 5v14M21 5v14'), P('M6.5 12h11'), P('m9.5 9-3 3 3 3M14.5 9l3 3-3 3')],
  'same-h': [P('M5 3h14M5 21h14'), P('M12 6.5v11'), P('m9 9.5 3-3 3 3M9 14.5l3 3 3-3')],
  'same-wh': [R(3, 3, 18, 18), P('M8 16 16 8'), P('M11 8h5v5'), P('M13 16H8v-5')],
  // groups: a dashed-cornered box round two frames / two frames apart
  group: [P('M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2'), R(7, 7, 7, 5), R(10, 12, 7, 5)],
  ungroup: [R(4, 4, 8, 6), R(12, 14, 8, 6)],
  // stacking order
  front: [R(8, 8, 8, 8, 2), P('M4 10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2'), P('M14 20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2')],
  forward: [P('M12 20V5'), P('m5.5 11.5 6.5-6.5 6.5 6.5')],
  backward: [P('M12 4v15'), P('m5.5 12.5 6.5 6.5 6.5-6.5')],
  back: [R(14, 14, 8, 8, 2), R(2, 2, 8, 8, 2), P('M7 14v1a2 2 0 0 0 2 2h1'), P('M14 7h1a2 2 0 0 1 2 2v1')],
  trash: [P('M3 6h18'), P('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'), P('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'), P('M10 11v6M14 11v6')],
  // the figure: new, rename, delete; make again; export
  'file-new': [PAGE, FOLD, P('M12 12v6M9 15h6')],
  'file-x': [PAGE, FOLD, P('m9.5 12.5 5 5M14.5 12.5l-5 5')],
  rename: [P('M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'), P('m15 5 4 4')],
  refresh: [P('M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), P('M3 3v5h5'), P('M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16'), P('M16 16h5v5')],
  download: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), P('m7 10 5 5 5-5'), P('M12 15V3')],
};

const NS = 'http://www.w3.org/2000/svg';
export function iconSvg(icon) {
  const spec = typeof icon === 'string' ? ICONS[icon] : icon;
  if (!spec) throw new Error(`compo: no icon “${icon}”`);
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, v);
  for (const [tag, attrs] of spec) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    s.append(e);
  }
  return s;
}

// a button that is an icon: label → aria-label, "label · keys — title" → the tooltip. `text` puts a
// short word beside the icon (an export's format, say) for where the icon alone can't tell.
export function iconButton({ icon, label, keys = '', title = '', text = '', run, cls = '' }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = ('compo-ico ' + cls).trim();
  b.setAttribute('aria-label', label);
  b.title = label + (keys ? ' · ' + keys : '') + (title ? ' — ' + title : '');
  b.append(iconSvg(icon));
  if (text) { const t = document.createElement('span'); t.textContent = text; b.append(t); b.classList.add('with-text'); }
  if (run) b.onclick = run;
  return b;
}
