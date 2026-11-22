// micro RUNS window (routines v2, step 4) — every routine run in the project: when, which routine,
// how it ended, what it was judged against, who accepted it. Accept marks a run as the baseline the
// next runs compare with (a sidecar file; the record itself is never edited).
import { floatWin } from './windows.js';
import { microPrompt } from './prompts.js';
import { listRuns, acceptRun } from './runrecord.js';

const $ = (s) => document.querySelector(s);
let _win = null;

export async function acceptRunAsk(dir) {
  const by = ((await microPrompt('accept this run as the baseline — accepted by (your name)', '')) || '').trim();
  if (!by) return null;
  const a = await acceptRun(dir, by);
  $('#meta').textContent = `${dir} accepted by ${a.by} — the next runs of this routine compare with it`;
  if (_win && _win._render) _win._render();
  return a;
}

export async function openRunsWindow() {
  if (_win) { _win._render(); return _win; }
  const win = _win = floatWin({ title: 'runs', sub: '', x: 120, y: 90, w: 620, h: 380, onClose: () => { _win = null; } });
  win.el.dataset.runs = '1';
  const body = document.createElement('div'); body.className = 'runs-body'; win.body.append(body);
  win._render = async () => {
    const runs = await listRuns();
    body.textContent = '';
    win.sub.textContent = runs.length ? `${runs.length} run${runs.length === 1 ? '' : 's'}` : 'no runs yet — run a routine (Tools → Recipes)';
    const tbl = document.createElement('table'); tbl.className = 'st-tbl';
    const hr = document.createElement('tr'); for (const h of ['started', 'routine', 'status', 'compared with', 'accepted', '']) { const th = document.createElement('th'); th.textContent = h; hr.append(th); } tbl.append(hr);
    for (const x of runs) {
      const tr = document.createElement('tr'); tr.dataset.dir = x.dir;
      const cells = [String(x.rec.started || '').replace('T', ' ').slice(0, 16), x.rec.routine ? x.rec.routine.name : '?', x.rec.status,
        x.rec.baseline ? `${x.rec.baseline.dir.replace(/^runs\//, '')}${x.rec.baseline.accepted ? ' ✓' : ''}` : '—',
        x.accepted ? `${x.accepted.by} · ${String(x.accepted.at).slice(0, 10)}` : ''];
      for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.append(td); }
      const td = document.createElement('td');
      if (!x.accepted && x.rec.status === 'ok') { const b = document.createElement('button'); b.className = 'awin-btn'; b.textContent = 'Accept…'; b.title = 'the baseline the next runs of this routine compare with'; b.onclick = () => acceptRunAsk(x.dir); td.append(b); }
      tr.append(td); tbl.append(tr);
    }
    body.append(tbl);
  };
  await win._render();
  return win;
}
