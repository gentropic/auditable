// wuffle desk — the menubar (@gcu/menu) and the keyboard shortcuts. Menus are built fresh each time they
// open (items reflect the project). Organised by what you are doing:
//   File      projects in and out, data and pictures out
//   Edit      undo, and the selection (it belongs to the data, on every diagram)
//   Data      measurements in, how a dataset is read, calculated columns, joins, rotations and corrections
//   Diagram   new diagrams, the active one's layers and settings, contours, Terzaghi, centring
//   Analysis  statistics, sets, comparison, results kept as data, slope stability, folds, cones
//   Figure    composed pages
//   Tools     the net's pointer tools (P L C B M)
//   View      panels, theme, the layout, field mode
// An item that changes the project RUNS THE CONSOLE'S OWN COMMAND, shown in the console as if typed: a menu
// and a typed line make the same change, land in the same history, and a routine can replay either. Items
// that need values ask for them in a small form (desk-ask.js) — never a command line.

import { MenuBar } from '../../../ext/menu/index.js';
import { alert, confirm, prompt } from '../../../ext/dialog/index.js';
import { THEMES } from './desk-theme.js';
import { TOCHER } from './samples.js';
import { TOOLS } from './desk-select.js';
import { columnsDialog } from './desk-columns.js';
import { ask } from './desk-ask.js';

export const ABOUT = 'wuffle — a stereonet workbench and a field compass, one file, no network. Maths by @gcu/bearing, '
  + 'nets by @gcu/stereonet. In the line of OpenStereo (Grohmann & Campanha, 2009/10) and its 2016 rewrite. Sample data: '
  + 'Tocher, F. E. (1979), The computer contouring of fabric diagrams, Computers & Geosciences 5, 73–126.';

const SHORTCUTS = [
  ['Ctrl+O', 'open data or a project'], ['Ctrl+S', 'save the project'], ['Ctrl+Z / Ctrl+Shift+Z', 'undo / redo'],
  ['`', 'the console'], ['P L C B M', 'pick, lasso, cone, band, measure (on a net)'], ['Esc', 'clear the drawn selection shapes'],
  ['right-click a net', 'what is under the cursor, the selection, the net, its picture'], ['drag a net (pick tool)', 'rotate it'],
  ['Tab (console)', 'complete a command, a path, a layer or a dataset'],
];
const ELEMENTS = [['poles', 'poles'], ['points', 'points'], ['greatCircles', 'great circles'], ['contours', 'contours'], ['mean', 'mean + cone'], ['eigen', 'eigenvectors'], ['labels', 'labels']];
const KIND_ADD = [['p', 'planes (dip direction / dip)'], ['l', 'lines (trend / plunge)'], ['sc', 'small circles (axis trend / plunge, half-angle)'], ['f', 'faults (plane, slip line or rake, sense)']];
const ADD_HINT = { p: '045/30 120/60 …   (strike/dip with a quadrant works too: 135/30SW)', l: '120→40 200/15 …', sc: '120/40 15   (the axis, then the half-angle)', f: '045/30 120/20 n   or   045/30 r35 r   (sense n r d s, optional)' };
// a name as one word for the console (it keeps "quoted names" whole)
const q = (s) => `"${String(s).replace(/"/g, '')}"`;
const ATT = /^\s*\d+(\.\d+)?\s*[/,→>]\s*\d+(\.\d+)?\s*$/;
const attOk = (s, what) => (ATT.test(String(s || '')) ? null : `${what}: two numbers, as 045/30`);

export function createMenus(host, { project: p, files, layout, theme, figures, tree, table, select, netMenu, consoleView, onStatus }) {
  const status = (s) => onStatus?.(s);
  // ── the active diagram and its layers, as the forms offer them ──
  const active = () => p.diagram(p.activeDiagram);
  const layerName = (L) => L.name || p.dataset(L.datasetId)?.name || '?';
  const layersOf = (kinds = null) => { const g = active(); return g ? p.layersOf(g.id).filter((L) => !kinds || kinds.includes(p.dataset(L.datasetId)?.kind)) : []; };
  const layerOpts = (kinds) => layersOf(kinds).map((L) => { const d = p.dataset(L.datasetId); return [layerName(L), `${layerName(L)} · ${d.kind} · ${d.rows.length}`]; });
  const firstLayer = (kinds) => { const Ls = layersOf(kinds); return Ls.length ? layerName(Ls.find((L) => L.visible) || Ls[0]) : null; };
  const layerField = (kinds, label = 'layer') => ({ key: 'layer', label, type: 'select', options: layerOpts(kinds), value: firstLayer(kinds) });
  const dsOpts = (pred = () => true) => p.datasets.filter(pred).map((d) => [d.name, `${d.name} · ${d.kind} · ${d.rows.length}`]);
  const shownDatasets = () => { const g = active(); return g ? [...new Set(p.layersOf(g.id).filter((L) => L.visible !== false).map((L) => L.datasetId))] : []; };
  const nSelected = () => shownDatasets().reduce((a, id) => a + p.selected(id).length, 0);

  /** a console line, run in the console where it shows; the answer → the status line, or a box when it is long */
  const exec = async (line, { title = null, box = false } = {}) => {
    const r = await consoleView.run(line);
    const text = (r.text || '').trim();
    if (!r.ok) { await alert(text || `“${line}” failed`, { title: 'wuffle' }); return r; }
    if (box || text.includes('\n')) await alert(text, { title: title || line.split(' ')[0] });
    else status(text || line);
    return r;
  };
  const form = async (spec, toLine, opts) => { const v = await ask(spec); if (!v) return null; const line = toLine(v); return line ? exec(line, opts) : null; };
  const noData = async (what) => { await alert(`${what} works on a layer of the active diagram — this one has none. Open some data (File → Open), or draw a dataset on it (the tree's menu).`); };
  const needLayers = (kinds, what) => (layersOf(kinds).length ? true : (noData(what), false));

  // a new diagram shows what the active one shows (views of the same data), so a rose of the net's sets is one click
  const newDiagram = (kind) => {
    const from = p.activeDiagram;
    const id = p.batch(`new ${kind}`, () => { const g = p.addDiagram(kind); if (from) for (const L of p.layersOf(from)) p.addView(L.id, g); return g; });
    p.setActive(id); layout.focusDiagram(id);
  };

  const commands = {
    undo: () => { const l = p.undo(); status(l ? `undid ${l}` : 'nothing to undo'); },
    redo: () => { const l = p.redo(); status(l ? `redid ${l}` : 'nothing to redo'); },
    open: () => files.pick(),
    savepage: () => files.savePage(),
    newproject: async () => { if (p.datasets.length && !(await confirm('Start a new, empty project? This one is gone unless you saved it (Undo can’t bring it back).', { okLabel: 'New project', danger: true }))) return; await files.newProject(); },
    tocher: () => files.addData(TOCHER, 'tocher.csv'),
    save: () => files.save(),
    newnet: () => newDiagram('net'),
    newrose: () => newDiagram('rose'),
    newfabric: () => newDiagram('fabric'),
    rmnet: async () => { const g = active(); if (g && await confirm(`Remove “${g.name}”? Its layers go; the data stays.`, { okLabel: 'Remove', danger: true })) p.removeDiagram(g.id); },
    renamenet: () => { const g = active(); if (g) return tree.diagramAction(g, 'rename'); },
    field: () => { const u = new URL(location.href); u.searchParams.delete('desk'); u.searchParams.set('field', ''); location.href = u.toString(); },
    // the build stamp is the page's own footer (the build writes it there; the desk hides the footer)
    about: () => { const v = (document.querySelector('.vfoot')?.textContent || '').trim(); return alert(ABOUT + '\n\n' + (v && !/__WUFFLE_BUILD__/.test(v) ? v : 'the development tree (unbuilt)')); },
    rename: async () => { const n = await prompt('Name of the project — files are saved under it', { defaultValue: p.name }); if (n && n.trim() && n.trim() !== p.name) { p.renameProject(n); status(`the project is “${p.name}” — saved as ${p.name.replace(/[^\w.-]+/g, '_')}.zip.wuffle`); } },
    figure: async () => { try { figures.newFigure(); } catch (e) { await alert(e.message); } },
    figbook: async () => { try { await figures.exportBook(); } catch (e) { await alert(e.message); } },
    console: () => { layout.focusConsole(); setTimeout(() => document.querySelector('.wcon textarea')?.focus(), 0); },
    tree: () => layout.focusTree(),
    table: () => layout.focusTable(),
    stats: () => layout.focusStats(),
    resetlayout: async () => { if (await confirm('Put the panels back where a new project has them? The diagrams and the data stay as they are.', { okLabel: 'Reset layout' })) { layout.reset(); status('the default layout'); } },
    help: async () => { commands.console(); await consoleView.run('help'); },
    keys: () => alert(SHORTCUTS.map(([k, t]) => `${k.padEnd(24)} ${t}`).join('\n'), { title: 'keyboard and mouse' }),
    clearshapes: () => select.clearShapes(),

    // ── the selection ──
    selall: () => exec('select all'),
    selnone: () => exec('select none'),
    selinv: () => exec('select invert'),
    selcone: () => form({ title: 'Select in a cone', note: 'every measurement within an angle of a direction (a plane\'s cone is about its pole)',
      fields: [{ key: 'as', label: 'about', type: 'select', options: [['l', 'a line (trend / plunge)'], ['p', 'a plane\'s pole (dip direction / dip)']], value: 'l' },
        { key: 'att', label: 'attitude', type: 'text', placeholder: '045/30', required: true }, { key: 'angle', label: 'angle (°)', type: 'number', value: 15, required: true },
        { key: 'mode', label: 'the selection', type: 'select', options: [['', 'replaces it'], ['+', 'adds to it'], ['-', 'takes from it']], value: '' }],
      check: (v) => attOk(v.att, 'attitude') || (v.angle > 0 && v.angle <= 90 ? null : 'an angle 0–90'), okLabel: 'Select' },
    (v) => `select ${v.mode ? v.mode + ' ' : ''}cone ${v.as} ${v.att.trim()} ${v.angle}`),
    selband: () => form({ title: 'Select in a band', note: 'every measurement within a half-width of a great circle',
      fields: [{ key: 'att', label: 'the plane (dd/dip)', type: 'text', placeholder: '045/30', required: true }, { key: 'w', label: 'half-width (°)', type: 'number', value: 10, required: true },
        { key: 'mode', label: 'the selection', type: 'select', options: [['', 'replaces it'], ['+', 'adds to it'], ['-', 'takes from it']], value: '' }],
      check: (v) => attOk(v.att, 'the plane') || (v.w > 0 && v.w <= 90 ? null : 'a half-width 0–90'), okLabel: 'Select' },
    (v) => `select ${v.mode ? v.mode + ' ' : ''}band ${v.att.trim()} ${v.w}`),
    selwhere: () => form({ title: 'Select where…', note: 'an expression over each row, on every dataset the active diagram shows: columns by name, and dip, dipdir, strike, trend, plunge, rake',
      fields: [{ key: 'expr', label: 'where', type: 'text', placeholder: "dip > 60 and set = 'S1'", required: true },
        { key: 'mode', label: 'the selection', type: 'select', options: [['', 'replaces it'], ['+', 'adds to it'], ['-', 'takes from it']], value: '' }],
      check: (v) => (/["$`]/.test(v.expr) ? 'quote text with \' (single quotes)' : null), okLabel: 'Select' },
    (v) => `select ${v.mode ? v.mode + ' ' : ''}where ${q(v.expr)}`),
    selds: () => {
      let last = null; const g = active();
      p.batch('selection → dataset', () => { for (const id of shownDatasets()) if (p.selected(id).length) { last = p.selectionToDataset(id); if (g) p.addLayer(g.id, last); } });
      if (last) { table.show(last); status(`→ ${p.dataset(last).name}`); }
    },
    selstats: () => { const v = layout.views.get(p.activeDiagram); return alert(v ? netMenu.selectionReport(v) : 'no diagram', { title: 'statistics of the selection' }); },

    // ── data ──
    add: () => form({ title: 'Add measurements', note: 'typed in, into a dataset of their own (“typed planes”, …) drawn on the active diagram — or into one you name',
      fields: [{ key: 'kind', label: 'kind', type: 'select', options: KIND_ADD, value: 'p' },
        { key: 'text', label: 'measurements', type: 'area', placeholder: ADD_HINT.p, required: true, rows: 5 },
        { key: 'to', label: 'into the dataset', type: 'text', placeholder: '(typed planes …)' }],
      check: (v) => (/["$`#]/.test(v.text) ? 'numbers, slashes and arrows only' : null), okLabel: 'Add', width: 500 },
    (v) => `add ${v.kind} ${v.text.trim().split(/[\s;]+/).join(' ')}${v.to.trim() ? ' --to ' + q(v.to.trim()) : ''}`),
    columns: async (name) => { const d = p.datasets.find((x) => x.name === name); if (d && await columnsDialog(p, d.id)) status(`${d.name}: read as ${p.dataset(d.id).kind}`); },
    calc: () => {
      if (!p.datasets.length) return noData('A calculated column');
      const cur = p.dataset(layersOf()[0]?.datasetId) || p.datasets[0];
      return form({ title: 'Calculated column', note: 'a column worked out from each row (@gcu/expr) — kept as a formula, so it follows the data. dip, dipdir, strike, pole_trend, trend, plunge and rake are there too',
        fields: [{ key: 'ds', label: 'dataset', type: 'select', options: dsOpts(), value: cur.name },
          { key: 'name', label: 'column name', type: 'text', placeholder: 'steep', required: true },
          { key: 'expr', label: 'expression', type: 'text', placeholder: "if(dip > 60, 'steep', 'shallow')", required: true }],
        check: (v) => (/["$`#]/.test(v.expr) ? 'quote text with \' (single quotes)' : /[=]/.test(v.name) ? 'a name without =' : null), okLabel: 'Calculate' },
      (v) => `calc --in ${q(v.ds)} ${q(v.name.trim())} = ${q(v.expr)}`);
    },
    join: async () => {
      const tables = p.datasets.filter((d) => d.kind === 'table'), meas = p.datasets.filter((d) => d.kind !== 'table');
      if (!tables.length || !meas.length) return alert('A join brings a TABLE\'s columns (a dataset read as a table, with no attitudes — Data → How a dataset is read) onto measurements, by a key they share. Open both first.');
      const a = await ask({ title: 'Join a table (1 of 2)', fields: [{ key: 'ds', label: 'onto the measurements', type: 'select', options: meas.map((d) => [d.name, d.name]) }, { key: 't', label: 'the table', type: 'select', options: tables.map((d) => [d.name, d.name]) }], okLabel: 'Next' });
      if (!a) return;
      const D = p.datasets.find((d) => d.name === a.ds), T = p.datasets.find((d) => d.name === a.t);
      const same = D.columns.find((c) => T.columns.includes(c));
      return form({ title: 'Join a table (2 of 2)', note: `the key: a column of ${D.name} and the column of ${T.name} that matches it — the result is a new dataset`,
        fields: [{ key: 'on', label: `${D.name} column`, type: 'select', options: D.columns.map((c) => [c, c]), value: same || D.columns[0] },
          { key: 'onT', label: `${T.name} column`, type: 'select', options: T.columns.map((c) => [c, c]), value: same || T.columns[0] }], okLabel: 'Join' },
      (v) => `join ${q(D.name)} ${q(T.name)} on ${q(v.on === v.onT ? v.on : `${v.on}=${v.onT}`)}`);
    },
    turn: () => needLayers(null, 'Rotating the data') && form({ title: 'Rotate the data', note: 'the measurements turned about an axis (clockwise looking down it), as a new dataset — View rotation (centre the net) leaves the data alone',
      fields: [layerField(), { key: 'axis', label: 'axis (tr/pl)', type: 'text', placeholder: '045/30', required: true }, { key: 'angle', label: 'angle (°)', type: 'number', placeholder: '20', required: true }],
      check: (v) => attOk(v.axis, 'axis'), okLabel: 'Rotate' }, (v) => `turn ${q(v.layer)} about ${v.axis.trim()} ${v.angle}`),
    untilt: () => needLayers(null, 'Untilting') && form({ title: 'Untilt', note: 'the measurements with a bedding\'s tilt taken out (rotated about its strike until it is flat), as a new dataset',
      fields: [layerField(), { key: 'bed', label: 'bedding (dd/dip)', type: 'text', placeholder: '120/35', required: true }],
      check: (v) => attOk(v.bed, 'bedding'), okLabel: 'Untilt' }, (v) => `untilt ${q(v.layer)} ${v.bed.trim()}`),
    declination: () => needLayers(null, 'Correcting to true north') && form({ title: 'Magnetic → true north', note: 'the measurements turned by the declination (east positive), as a new dataset — typed, or worked out by the World Magnetic Model for a place and a day',
      fields: [layerField(), { key: 'how', label: 'the declination', type: 'select', options: [['deg', 'I know it'], ['wmm', 'from a place and a date (WMM2025)']], value: 'deg' },
        { key: 'deg', label: 'degrees, east +', type: 'number', step: 'any', placeholder: '-21.3', showIf: (v) => v.how === 'deg' },
        { key: 'lat', label: 'latitude', type: 'number', step: 'any', placeholder: '-20.3', showIf: (v) => v.how === 'wmm' },
        { key: 'lon', label: 'longitude', type: 'number', step: 'any', placeholder: '-43.9', showIf: (v) => v.how === 'wmm' },
        { key: 'date', label: 'date', type: 'text', value: new Date().toISOString().slice(0, 10), showIf: (v) => v.how === 'wmm' }],
      check: (v) => (v.how === 'deg' ? (v.deg == null ? 'the declination is needed, in degrees' : null) : (v.lat == null || v.lon == null ? 'the latitude and longitude are needed' : /^\d{4}-\d\d-\d\d$/.test(v.date) ? null : 'a date as YYYY-MM-DD')), okLabel: 'Correct' },
    (v) => (v.how === 'deg' ? `declination ${q(v.layer)} ${v.deg}` : `declination ${q(v.layer)} --at ${v.lat},${v.lon} --date ${v.date}`)),

    // ── diagram ──
    contours: () => needLayers(['planes', 'lines', 'faults'], 'Contouring') && (() => {
      const kinds = Object.fromEntries(layersOf().map((L) => [layerName(L), p.dataset(L.datasetId).kind]));
      const L0 = layersOf(['planes', 'lines', 'faults']).find((L) => layerName(L) === firstLayer(['planes', 'lines', 'faults'])), E = L0?.elements?.contours || {};
      return form({ title: 'Contours', note: 'density contours of a layer\'s poles (or lines) — Kamb in multiples of σ, or a Fisher kernel',
        fields: [layerField(['planes', 'lines', 'faults']), { key: 'method', label: 'method', type: 'select', options: [['kamb', 'Kamb (σ)'], ['fisher', 'Fisher kernel']], value: E.method || 'kamb' },
          { key: 'k', label: 'Kamb k (σ)', type: 'number', value: E.sigma ?? 3, showIf: (v) => v.method === 'kamb' },
          { key: 'filled', label: 'filled bands', type: 'check', value: !!E.filled },
          { key: 'levels', label: 'levels (optional)', type: 'text', value: E.levels ? E.levels.join(', ') : '', placeholder: '2, 4, 6, 8' },
          { key: 'of', label: 'of the fault\'s', type: 'select', options: [['poles', 'planes (poles)'], ['slip', 'slip lines']], value: E.of || 'poles', showIf: (v) => kinds[v.layer] === 'faults' }],
        check: (v) => (v.levels.trim() && !/^[\d.\s,]+$/.test(v.levels) ? 'levels as numbers: 2, 4, 6' : null), okLabel: 'Contour' },
      (v) => `contour ${v.method}${v.method === 'kamb' ? ' ' + (v.k || 3) : ''} ${q(v.layer)} ${v.filled ? '--filled' : '--lines'}${v.levels.trim() ? ' --levels ' + v.levels.trim().split(/[\s,]+/).join(',') : ''}${kinds[v.layer] === 'faults' ? ' --of ' + v.of : ''}`);
    })(),
    terzaghi: () => needLayers(['planes', 'faults'], 'Terzaghi weighting') && form({ title: 'Terzaghi weighting', note: 'planes sampled along a scanline or borehole are weighted for the ones it is unlikely to cross (contours use it, statistics don\'t); a weight column is written',
      fields: [layerField(['planes', 'faults']), { key: 'off', label: 'switch it off', type: 'check', value: false },
        { key: 'line', label: 'scanline (tr/pl)', type: 'text', placeholder: '090/00', showIf: (v) => !v.off }, { key: 'max', label: 'cap the weight at', type: 'number', value: 10, showIf: (v) => !v.off }],
      check: (v) => (v.off ? null : attOk(v.line, 'the scanline')), okLabel: 'Apply' },
    (v) => (v.off ? `terzaghi ${q(v.layer)} off` : `terzaghi ${q(v.layer)} ${v.line.trim()} --max ${v.max ?? 10}`)),
    center: () => form({ title: 'Centre the net on…', note: 'the view turned so a direction is at the centre — the data stays as it is (Data → Rotate the data turns the data)',
      fields: [{ key: 'line', label: 'direction (tr/pl)', type: 'text', placeholder: '045/30', required: true }], check: (v) => attOk(v.line, 'direction'), okLabel: 'Centre' },
    (v) => `rotate ${q(v.line.trim().replace(/[/,>]/, '→'))}`),
    uncenter: () => exec('rotate off'),

    // ── analysis ──
    statsof: () => needLayers(['planes', 'lines', 'faults', 'smallcircles'], 'Statistics') && form({ title: 'Statistics of a layer',
      fields: [layerField(), { key: 'sel', label: 'the selection only', type: 'check', value: nSelected() > 0 }, { key: 'boot', label: 'bootstrap resamplings', type: 'number', placeholder: '(none — 1000 is usual)' }], okLabel: 'Compute' },
    (v) => `stats ${q(v.layer)}${v.sel ? ' --selection' : ''}${v.boot ? ' --bootstrap ' + Math.round(v.boot) : ''}`, { box: true, title: 'statistics' }),
    sets: () => needLayers(['planes', 'lines', 'faults'], 'Finding sets') && form({ title: 'Find sets', note: 'a mixture of Fisher distributions fitted to the layer; each row\'s set goes in a column “set” (colour by it, filter by it)',
      fields: [layerField(['planes', 'lines', 'faults']), { key: 'k', label: 'how many sets', type: 'number', placeholder: '(chosen by BIC)' }],
      check: (v) => (v.k == null || (v.k >= 1 && v.k <= 9) ? null : '1 to 9 sets'), okLabel: 'Find' },
    (v) => `sets ${q(v.layer)}${v.k ? ' ' + Math.round(v.k) : ''}`, { box: true, title: 'sets' }),
    compare: () => (layersOf().length < 2 ? alert('Comparing needs two layers on the active diagram.') : form({ title: 'Compare two layers', note: 'Watson\'s test: could the two share one mean direction?',
      fields: [{ ...layerField(), label: 'one' }, { key: 'b', label: 'and the other', type: 'select', options: layerOpts(), value: layerName(layersOf()[1]) }],
      check: (v) => (v.layer === v.b ? 'two different layers' : null), okLabel: 'Compare' }, (v) => `compare ${q(v.layer)} ${q(v.b)}`, { box: true, title: 'compare' })),
    keep: (what, name) => exec(`${what} ${q(name)}`),
    intersect: () => (layersOf(['planes', 'faults']).length < 2 ? alert('An intersection needs two layers of planes on the active diagram.') : form({ title: 'Intersection of two means', note: 'the line where the two layers\' mean planes meet, as a dataset',
      fields: [{ ...layerField(['planes', 'faults']), label: 'one' }, { key: 'b', label: 'and the other', type: 'select', options: layerOpts(['planes', 'faults']), value: layerName(layersOf(['planes', 'faults'])[1]) }],
      check: (v) => (v.layer === v.b ? 'two different layers' : null), okLabel: 'Intersect' }, (v) => `intersect ${q(v.layer)} ${q(v.b)}`)),
    lineations: () => (!layersOf(['planes', 'faults']).length ? noData('Lineations') : form({ title: 'Intersection lineations', note: 'every plane of one layer against every plane of the other: the lines they meet in, as a dataset (one layer against itself works too)',
      fields: [{ ...layerField(['planes', 'faults']), label: 'one' }, { key: 'b', label: 'and the other', type: 'select', options: layerOpts(['planes', 'faults']), value: layerName(layersOf(['planes', 'faults']).at(-1)) }], okLabel: 'Intersect' },
    (v) => `lineations ${q(v.layer)} ${q(v.b)}`)),
    kinematic: () => needLayers(['planes', 'faults'], 'Slope stability') && form({ title: 'Slope stability (kinematic)', note: 'planar sliding, wedges and toppling, Markland\'s tests against a slope face; each plane\'s modes go in a “kinematic” column, and the face and the friction cone are drawn',
      fields: [layerField(['planes', 'faults'], 'discontinuities'), { key: 'face', label: 'slope face (dd/dip)', type: 'text', placeholder: '180/60', required: true },
        { key: 'phi', label: 'friction angle φ (°)', type: 'number', value: 30 }, { key: 'lat', label: 'lateral limit (±°)', type: 'number', value: 20 }],
      check: (v) => attOk(v.face, 'the face') || (v.phi >= 0 && v.phi < 90 ? null : 'φ 0–90') || (v.lat > 0 && v.lat <= 90 ? null : 'a lateral limit 1–90'), okLabel: 'Analyse' },
    (v) => `kinematic ${q(v.layer)} ${v.face.trim()} --phi ${v.phi} --lateral ${v.lat}`, { box: true, title: 'slope stability' }),
    fold: () => needLayers(['planes', 'faults'], 'Fold analysis') && form({ title: 'Fold', note: 'the π-girdle of the bedding poles: the fold axis, cylindricity, the limbs and interlimb angle, the axial plane, Fleuty\'s names',
      fields: [layerField(['planes', 'faults'], 'bedding'), { key: 'rec', label: 'a recumbent fold', type: 'check', value: false }, { key: 'keep', label: 'draw the axis and the axial plane', type: 'check', value: true }], okLabel: 'Analyse' },
    (v) => `fold ${q(v.layer)}${v.rec ? ' --recumbent' : ''}${v.keep ? ' --keep' : ''}`, { box: true, title: 'fold' }),
    cone: () => needLayers(['planes', 'lines', 'faults'], 'Fitting a cone') && form({ title: 'Best-fit cone', note: 'the small circle that best fits the poles (a conical fold): its axis and half-angle',
      fields: [layerField(['planes', 'lines', 'faults']), { key: 'keep', label: 'draw it', type: 'check', value: true }], okLabel: 'Fit' },
    (v) => `cone ${q(v.layer)}${v.keep ? ' --keep' : ''}`, { box: true, title: 'best-fit cone' }),
  };

  // ── the menus ──
  const withPrefix = (items, pre) => items.map((it) => (typeof it === 'string' ? it : { ...it, ...(it.action ? { action: pre + it.action } : {}), ...(it.children ? { children: withPrefix(it.children, pre) } : {}) }));
  const layerMenu = (L) => {
    const d = p.dataset(L.datasetId);
    return { label: `${layerName(L)}${L.visible === false ? ' (hidden)' : ''}`, children: [
      ...ELEMENTS.filter(([k]) => L.elements[k]).map(([k, t]) => ({ label: t, action: `el:${L.id}:${k}`, checked: !!L.elements[k].on })),
      '---',
      { label: L.visible === false ? 'Show the layer' : 'Hide the layer', action: `vis:${L.id}` },
      { label: 'Properties…', action: `props:${L.id}` },
      { label: `Show ${d.name} in the table`, action: `tbl:${d.id}` },
    ] };
  };
  const keepMenu = (what, label, kinds) => { const Ls = layersOf(kinds); return { label, disabled: !Ls.length, children: Ls.map((L) => ({ label: layerName(L), action: `keep:${what}:${layerName(L)}` })) }; };

  // what the menus depend on, read each time one opens (MenuBar evaluates its list once; each items() runs on open)
  const now = () => { const g = active(); return { g, Ls: g ? p.layersOf(g.id) : [], isNet: g?.kind === 'net', nSel: nSelected() }; };
  const bar = new MenuBar(host, () => [
      { label: 'File', items: () => { const { g, Ls, isNet, nSel } = now(); return [
        { label: 'New project', action: 'newproject' },
        { label: 'Open data or a project…', action: 'open', shortcut: 'Ctrl+O' },
        { label: 'Open the tocher sample', action: 'tocher' },
        '---',
        { label: 'Rename project…', action: 'rename' },
        { label: 'Save project (.zip.wuffle)', action: 'save', shortcut: 'Ctrl+S' },
        { label: 'Save as page (one .html, the project inside)', action: 'savepage', disabled: !files.canSavePage() },
        '---',
        { label: 'Export data', disabled: !p.datasets.length, children: p.datasets.map((d) => ({ label: d.name, children: [{ label: 'CSV', action: `export:csv:${d.name}` }, { label: 'GeoJSON (needs lon / lat or x / y)', action: `export:geojson:${d.name}` }] })) },
        { label: g ? `Export “${g.name}”` : 'Export the diagram', disabled: !g, children: [{ label: 'SVG', action: 'pic:svg' }, { label: 'PNG', action: 'pic:png' }, { label: 'Copy as a picture', action: 'pic:copy' }] },
      ]; } },
      { label: 'Edit', items: () => { const { g, Ls, isNet, nSel } = now(); return [
        { label: p.canUndo() ? `Undo ${p.undoLabel()}` : 'Undo', action: 'undo', shortcut: 'Ctrl+Z', disabled: !p.canUndo() },
        { label: p.canRedo() ? `Redo ${p.redoLabel()}` : 'Redo', action: 'redo', shortcut: 'Ctrl+Shift+Z', disabled: !p.canRedo() },
        '---',
        { label: 'Select all', action: 'selall', disabled: !Ls.length },
        { label: 'Select none', action: 'selnone', disabled: !nSel },
        { label: 'Invert the selection', action: 'selinv', disabled: !Ls.length },
        { label: 'Select in a cone…', action: 'selcone', disabled: !Ls.length },
        { label: 'Select in a band…', action: 'selband', disabled: !Ls.length },
        { label: 'Select where…', action: 'selwhere', disabled: !Ls.length },
        '---',
        { label: nSel ? `Selection (${nSel}) → new dataset` : 'Selection → new dataset', action: 'selds', disabled: !nSel },
        { label: 'Statistics of the selection', action: 'selstats', disabled: !nSel },
      ]; } },
      { label: 'Data', items: () => { const { g, Ls, isNet, nSel } = now(); return [
        { label: 'Add measurements…', action: 'add' },
        { label: 'How a dataset is read…', disabled: !p.datasets.length, children: p.datasets.map((d) => ({ label: `${d.name} · ${d.kind}`, action: 'columns:' + d.name })) },
        { label: 'Calculated column…', action: 'calc', disabled: !p.datasets.length },
        { label: 'Join a table…', action: 'join', disabled: !p.datasets.some((d) => d.kind === 'table'), title: 'a table (a dataset with no attitudes, read as a table) joined onto measurements by a key' },
        { label: 'Show in the table', disabled: !p.datasets.length, children: p.datasets.map((d) => ({ label: d.name, action: 'tbl:' + d.id })) },
        '---',
        { label: 'Rotate the data…', action: 'turn', disabled: !Ls.length },
        { label: 'Untilt (take out a bedding\'s tilt)…', action: 'untilt', disabled: !Ls.length },
        { label: 'Magnetic → true north…', action: 'declination', disabled: !Ls.length },
      ]; } },
      { label: 'Diagram', items: () => { const { g, Ls, isNet, nSel } = now(); return [
        { label: 'New net', action: 'newnet' },
        { label: 'New rose diagram', action: 'newrose' },
        { label: 'New fabric plot', action: 'newfabric' },
        '---',
        { label: g ? `Layers of ${g.name}` : 'Layers', disabled: !Ls.length, children: Ls.map(layerMenu) },
        ...(g ? withPrefix(tree.diagramItems(g), 'dg:') : []),
        ...(isNet ? [
          '---',
          { label: 'Contours…', action: 'contours', disabled: !layersOf(['planes', 'lines', 'faults']).length },
          { label: 'Terzaghi weighting…', action: 'terzaghi', disabled: !layersOf(['planes', 'faults']).length },
          { label: 'Centre the net on…', action: 'center' },
        ] : []),
        '---',
        { label: 'Rename the diagram…', action: 'renamenet', disabled: !g },
        { label: 'Remove the diagram', action: 'rmnet', disabled: !g, danger: true },
      ]; } },
      { label: 'Analysis', items: () => { const { g, Ls, isNet, nSel } = now(); return [
        { label: 'Statistics of a layer…', action: 'statsof', disabled: !Ls.length },
        { label: 'The statistics panel', action: 'stats' },
        { label: 'Find sets…', action: 'sets', disabled: !layersOf(['planes', 'lines', 'faults']).length },
        { label: 'Compare two layers (Watson)…', action: 'compare', disabled: Ls.length < 2 },
        '---',
        keepMenu('mean', 'Keep the mean as data', ['planes', 'lines', 'faults']),
        keepMenu('eigen', 'Keep the eigenvectors as data', ['planes', 'lines', 'faults']),
        keepMenu('beta', 'Keep the β-axis as data', ['planes', 'faults']),
        { label: 'Intersection of two means…', action: 'intersect', disabled: layersOf(['planes', 'faults']).length < 2 },
        { label: 'Intersection lineations…', action: 'lineations', disabled: !layersOf(['planes', 'faults']).length },
        '---',
        { label: 'Slope stability (kinematic)…', action: 'kinematic', disabled: !layersOf(['planes', 'faults']).length },
        { label: 'Fold…', action: 'fold', disabled: !layersOf(['planes', 'faults']).length },
        { label: 'Best-fit cone…', action: 'cone', disabled: !layersOf(['planes', 'lines', 'faults']).length },
      ]; } },
      { label: 'Figure', items: () => { const { g, Ls, isNet, nSel } = now(); return [
        { label: 'New figure from the active diagram', action: 'figure', disabled: !g },
        { label: 'Export all figures as one PDF…', action: 'figbook', disabled: p.figures.length < 1, title: 'every figure, in the order listed, one per page: numbered on across the book, a footer with the page' },
        ...(p.figures.length ? ['---', ...p.figures.map((f) => ({ label: f.name, action: 'openfig:' + f.id }))] : []),
      ]; } },
      { label: 'Tools', items: () => { const { g, Ls, isNet, nSel } = now(); return [
        ...TOOLS.map(([id, label, title, key]) => ({ label: label[0].toUpperCase() + label.slice(1), action: 'tool:' + id, checked: select.tool === id, group: 'tool', shortcut: key, title })),
        '---',
        { label: 'Clear the drawn shapes', action: 'clearshapes', shortcut: 'Esc' },
      ]; } },
      { label: 'View', items: () => { const { g, Ls, isNet, nSel } = now(); return [
        { label: 'Theme', children: THEMES.map(([k, t]) => ({ label: t, action: 'theme:' + k, checked: theme.pref === k, group: 'theme' })) },
        '---',
        { label: 'Layers (the tree)', action: 'tree' },
        { label: 'Table', action: 'table' },
        { label: 'Statistics', action: 'stats' },
        { label: 'Console', action: 'console', shortcut: '`' },
        '---',
        { label: 'Reset layout', action: 'resetlayout', title: 'the panels where a new project has them' },
        '---',
        { label: 'Field mode (the compass)', action: 'field' },
      ]; } },
      { label: 'Help', items: () => { const { g, Ls, isNet, nSel } = now(); return [
        { label: 'Console commands', action: 'help' },
        { label: 'Keyboard and mouse', action: 'keys' },
        '---',
        { label: 'About wuffle', action: 'about' },
      ]; } },
  ]);

  const run = async (a) => {
    try {
      const g = active(), arg = (n) => a.split(':').slice(n).join(':');
      if (a.startsWith('theme:')) theme.set(arg(1));
      else if (a.startsWith('openfig:')) figures.open(arg(1));
      else if (a.startsWith('tool:')) { select.setTool(arg(1)); status(`tool: ${arg(1)}`); }
      else if (a.startsWith('export:')) await exec(`export ${q(arg(2))} ${a.split(':')[1]}`);
      else if (a.startsWith('pic:')) { if (g) await netMenu.exportPicture(g.id, arg(1)); }
      else if (a.startsWith('columns:')) await commands.columns(arg(1));
      else if (a.startsWith('tbl:')) { table.show(arg(1)); layout.focusTable(); }
      else if (a.startsWith('keep:')) await commands.keep(a.split(':')[1], arg(2));
      else if (a.startsWith('el:')) { const [, lid, k] = a.split(':'); const L = p.layer(lid); if (L) p.setElement(L.id, k, !L.elements[k].on); }
      else if (a.startsWith('vis:')) { const L = p.layer(arg(1)); if (L) p.setLayerVisible(L.id, L.visible === false); }
      else if (a.startsWith('props:')) tree.properties(arg(1));
      else if (a.startsWith('dg:')) { if (g) await tree.diagramAction(g, arg(1)); }
      else await commands[a]?.();
    } catch (e) { await alert(e.message); }
    bar.refresh();
  };
  bar.on('action', run);
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !document.body.classList.contains('desk')) return;
    if (e.key === 'o') { e.preventDefault(); run('open'); } else if (e.key === 's') { e.preventDefault(); run('save'); }
    // undo / redo — not while typing, and not inside a figure (compo has its own undo there)
    else if (/^[zy]$/i.test(e.key) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) && !e.target?.closest?.('.wfig-host')) {
      e.preventDefault(); run(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo');
    }
  });
  // ` opens the console (not while typing somewhere)
  addEventListener('keydown', (e) => {
    if (e.key !== '`' || e.ctrlKey || e.metaKey || !document.body.classList.contains('desk')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault(); run('console');
  });
  return { bar, run, commands };
}
