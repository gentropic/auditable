// wuffle desk — the COLUMN-MAPPING dialog: how a dataset is read, set by hand. The reader guesses (io.js
// sniffRoles) and never refuses; when it guessed wrong — a "dip" that is a dip direction, strike with a quadrant
// letter, a rake instead of a slip line, a table read as planes — this says what each column is. Live: it counts the
// rows that read as you choose. One undo step (model.setReading).

import { Dialog, confirm } from '../../../ext/dialog/index.js';
import { orientations } from './io.js';

// per kind, the FORMS its attitudes can take — each a list of roles, in the order a person reads them
const FORMS = {
  planes: [['dip direction / dip', ['dipDir', 'dip']], ['strike / dip (right-hand rule)', ['strike', 'dip']], ['strike / dip + quadrant (030, 40, SE)', ['strike', 'dip', 'quadrant']], ['one text column (045/30, N30E 40SE)', ['attitude']]],
  lines: [['trend / plunge', ['trend', 'plunge']], ['one text column (045→30)', ['attitude']]],
  faults: [['dip direction / dip + slip trend / plunge', ['dipDir', 'dip', 'trend', 'plunge']], ['dip direction / dip + rake', ['dipDir', 'dip', 'rake']], ['strike / dip + slip trend / plunge', ['strike', 'dip', 'trend', 'plunge']], ['strike / dip + rake', ['strike', 'dip', 'rake']]],
  smallcircles: [['axis trend / plunge + half-angle', ['trend', 'plunge', 'angle']]],
  table: [['no attitudes (joined onto measurements)', []]],
};
const EXTRAS = { planes: ['set', 'weight'], lines: ['set', 'weight'], faults: ['sense', 'set', 'weight'], smallcircles: ['set'], table: [] };
const ROLE_LABEL = { dipDir: 'dip direction', dip: 'dip', strike: 'strike', quadrant: 'dip quadrant', attitude: 'attitude text', trend: 'trend', plunge: 'plunge', rake: 'rake', angle: 'half-angle', sense: 'sense', set: 'set', weight: 'weight' };
const KIND_LABEL = { planes: 'planes', lines: 'lines', faults: 'faults (plane + slip)', smallcircles: 'small circles', table: 'a table (no attitudes)' };

/** the form a dataset's current roles match (else the kind's first) */
function formOf(kind, roles) {
  const forms = FORMS[kind] || []; const has = (r) => r.every((k) => roles[k]);
  return Math.max(0, forms.findIndex(([, r]) => has(r) && (r.includes('strike') || !roles.strike) && (r.includes('rake') || !roles.rake)));
}

export async function columnsDialog(p, datasetId) {
  const ds = p.dataset(datasetId); if (!ds) return false;
  const st = { kind: ds.kind, roles: { ...ds.roles } };
  st.form = formOf(st.kind, st.roles);
  const res = await new Dialog({
    title: `${ds.name} · how it is read`, width: 470,
    render(body, ctx) {
      const h = (t, cls, text) => { const e = document.createElement(t); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
      const row = (label, el) => { const r = h('label', 'wprow'); r.append(h('span', null, label), el); return r; };
      const sel = (opts, v) => { const s = h('select'); for (const [k, t] of opts) s.append(new Option(t, k)); s.value = v; return s; };
      const colOpts = (none) => [...(none ? [['', none]] : []), ...ds.columns.map((c) => [c, c])];
      const kindSel = sel(Object.entries(KIND_LABEL), st.kind), formBox = h('div'), rolesBox = h('div'), note = h('p', 'wpnote');
      const bar = h('div', 'wpbar'), ok = h('button', 'primary', 'Apply'), cancel = h('button', null, 'Cancel'); ok.type = cancel.type = 'button'; ok.dataset.default = 'true';
      bar.append(cancel, ok);
      body.append(h('p', 'wpnote', ds.meta?.read?.why ? `wuffle read it as ${ds.kind}: ${ds.meta.read.why}` : `read as ${ds.kind}`), row('kind', kindSel), formBox, rolesBox, note, bar);
      const roleList = () => (FORMS[st.kind][st.form] || ['', []])[1];
      const preview = () => {
        if (st.kind === 'table') { note.textContent = `${ds.rows.length} rows, no attitudes — shown and joined, never drawn`; note.classList.remove('bad'); ok.disabled = false; return; }
        const missing = roleList().filter((r) => !st.roles[r]);
        if (missing.length) { note.textContent = `choose a column for ${missing.map((r) => ROLE_LABEL[r]).join(', ')}`; note.classList.add('bad'); ok.disabled = true; return; }
        const roles = Object.fromEntries([...roleList(), ...EXTRAS[st.kind]].filter((r) => st.roles[r]).map((r) => [r, st.roles[r]]));
        const n = orientations({ ...ds, kind: st.kind, roles, notation: roles.attitude ? 'text' : roles.quadrant ? 'quadrant' : roles.strike && !roles.dipDir ? 'rhr' : 'dd' }).filter(Boolean).length;
        note.textContent = `${n} of ${ds.rows.length} rows read this way${n < ds.rows.length ? ` — ${ds.rows.length - n} don't (blank, or out of range)` : ''}`;
        note.classList.toggle('bad', n === 0); ok.disabled = n === 0;
      };
      const drawRoles = () => {
        rolesBox.replaceChildren();
        for (const r of [...roleList(), ...EXTRAS[st.kind]]) {
          const extra = !roleList().includes(r);
          const s = sel(colOpts(extra ? '— none' : '— choose'), st.roles[r] || ''); s.dataset.role = r;
          s.onchange = () => { if (s.value) st.roles[r] = s.value; else delete st.roles[r]; preview(); };
          rolesBox.append(row(ROLE_LABEL[r] + (extra ? ' (optional)' : ''), s));
        }
        preview();
      };
      const drawForms = () => {
        formBox.replaceChildren();
        const forms = FORMS[st.kind];
        if (forms.length > 1) { const f = sel(forms.map(([t], i) => [String(i), t]), String(st.form)); f.className = 'wc-form'; f.onchange = () => { st.form = +f.value; drawRoles(); }; formBox.append(row('written as', f)); }
        drawRoles();
      };
      kindSel.onchange = () => { st.kind = kindSel.value; st.form = formOf(st.kind, st.roles); drawForms(); };
      cancel.onclick = () => ctx.close(null);
      ok.onclick = () => ctx.close({ kind: st.kind, roles: Object.fromEntries([...roleList(), ...EXTRAS[st.kind]].filter((r) => st.roles[r]).map((r) => [r, st.roles[r]])) });
      drawForms();
    },
  }).show();
  if (!res) return false;
  if (res.kind === 'table' && ds.kind !== 'table' && p.usesOf(datasetId).length) {
    if (!(await confirm(`As a table “${ds.name}” isn't drawn: it comes off ${[...new Set(p.usesOf(datasetId).map((u) => u.diagramName))].join(', ')}. The rows stay.`, { okLabel: 'Read as a table' }))) return false;
  }
  p.setReading(datasetId, res);
  return true;
}
