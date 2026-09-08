// File operations — new/open/save .plan JSON

async function newFile() {
  if (PP.dirty && !confirm('Discard unsaved changes?')) return;
  PP.tasks = [createTask()];
  PP.templates = [];
  PP.calendar = { weekends: [0, 6], holidays: [], blocked: [] };
  PP.calendarPreset = null;
  PP.projectStart = new Date().toISOString().slice(0, 10);
  PP.deadlines = [];
  PP.scheduleResult = null;
  PP.mcResult = null;
  PP.evmResult = null;
  PP.fileHandle = null;
  PP.fileName = null;
  PP.dirty = false;
  PP.undoStack = [];
  PP.redoStack = [];
  projectCreate();
  startProject();
}

async function openFile() {
  try {
    let file, handle;
    if (window.showOpenFilePicker) {
      [handle] = await window.showOpenFilePicker({
        types: [
          { description: 'Plan files', accept: { 'application/json': ['.plan', '.json'] } },
        ],
      });
      file = await handle.getFile();
    } else {
      file = await pickFile('.plan,.json');
      if (!file) return;
      handle = null;
    }

    const text = await file.text();
    const data = JSON.parse(text);
    loadProjectData(data);
    PP.fileHandle = handle;
    PP.fileName = file.name;
    PP.dirty = false;
    const pname = (PP.fileName || 'untitled').replace(/\.\w+$/, '');
    projectCreate(pname);
    startProject();
    setStatus('msg', 'opened ' + file.name);
  } catch (e) {
    if (e.name !== 'AbortError') setStatus('msg', 'open failed: ' + e.message);
  }
}

async function saveFile() {
  if (PP.fileHandle) {
    try {
      const writable = await PP.fileHandle.createWritable();
      await writable.write(serializeProject());
      await writable.close();
      PP.dirty = false;
      projectSave();
      updateTitle();
      setStatus('msg', 'saved');
      return;
    } catch (e) {
      // Fall through
    }
  }
  // No file handle — localStorage
  if (isProjectUntitled()) {
    showRenamePrompt('untitled', name => {
      projectUpdateName(name);
      PP.fileName = name;
      PP.dirty = false;
      projectSave();
      updateTitle();
      setStatus('msg', 'saved as ' + name);
    });
    return;
  }
  PP.dirty = false;
  projectSave();
  updateTitle();
  setStatus('msg', 'saved');
}

async function saveFileAs() {
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: PP.fileName || 'untitled.plan',
        types: [{ description: 'Plan files', accept: { 'application/json': ['.plan'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(serializeProject());
      await writable.close();
      PP.fileHandle = handle;
      PP.fileName = handle.name;
      PP.dirty = false;
      projectUpdateName(handle.name.replace(/\.\w+$/, ''));
      projectSave();
      updateTitle();
      setStatus('msg', 'saved');
    } else {
      downloadBlob(serializeProject(), PP.fileName || 'untitled.plan', 'application/json');
      PP.dirty = false;
      updateTitle();
      setStatus('msg', 'downloaded');
    }
  } catch (e) {
    if (e.name !== 'AbortError') setStatus('msg', 'save failed: ' + e.message);
  }
}

function serializeProject() {
  const projects = getProjects();
  const p = projects.find(e => e.id === PP.projectId);
  return serializePlan({
    title: (p && p.name) || PP.fileName || 'untitled',
    projectStart: PP.projectStart,
    calendar: PP.calendar,
    calendarPreset: PP.calendarPreset,
    deadlines: PP.deadlines,
    baseline: PP.baseline,
    templates: PP.templates,
    tasks: PP.tasks,
    settings: {
      showFloat: PP.ui.showFloat,
      showProgress: PP.ui.showProgress,
      pxPerDay: GANTT.pxPerDay,
      mcIterations: PP.mcIterations || 5000,
    },
  });
}

function loadProjectData(data) {
  const project = parsePlan(data);

  PP.tasks = project.tasks.map(t => createTask(t));
  PP.templates = project.templates.map(t => ({
    ...createTemplate(t),
    tasks: (t.tasks || []).map(tt => createTemplateTask(tt)),
  }));
  PP.projectStart = project.projectStart;
  PP.deadlines = project.deadlines;
  PP.undoStack = [];
  PP.redoStack = [];
  PP.mcResult = null;
  PP.evmResult = null;
  PP.baseline = project.baseline;
  PP.calendarPreset = project.calendarPreset;
  PP.calendar = project.calendar;

  const s = project.settings;
  if (s.showFloat != null) PP.ui.showFloat = s.showFloat;
  if (s.showProgress != null) PP.ui.showProgress = s.showProgress;
  if (s.pxPerDay != null) GANTT.pxPerDay = Math.max(GANTT.minPx, Math.min(GANTT.maxPx, s.pxPerDay));
  if (s.mcIterations != null) PP.mcIterations = s.mcIterations;
}

// Helpers

function downloadBlob(data, filename, type) {
  const blob = typeof data === 'string' ? new Blob([data], { type }) :
    data instanceof Blob ? data :
    new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

function updateTitle() {
  const name = PP.fileName || 'untitled';
  document.title = (PP.dirty ? '\u2022 ' : '') + name + ' \u2014 Plan';
}

function startProject() {
  createTaskWindow();
  showTaskWindow();
  buildGrid();
  evaluate();
  updateTitle();
  // Restore cached MC results
  if (PP.projectId) {
    mcLoad(PP.projectId).then(data => {
      if (data) {
        PP.mcResult = data;
        updateGantt();
      }
    });
  }
}

// ── Baseline ──

function saveBaseline() {
  if (!PP.scheduleResult || !PP.scheduleResult.scheduled.length) {
    setStatus('msg', 'no schedule to baseline');
    return;
  }
  const bl = {};
  for (const s of PP.scheduleResult.scheduled) {
    bl[s.id] = {
      start: s.earlyStart instanceof Date ? s.earlyStart.toISOString() : s.earlyStart,
      end: s.earlyFinish instanceof Date ? s.earlyFinish.toISOString() : s.earlyFinish,
    };
  }
  PP.baseline = bl;
  PP.dirty = true;
  updateTitle();
  updateGantt();
  setStatus('msg', 'baseline saved');
}

function clearBaseline() {
  PP.baseline = null;
  PP.dirty = true;
  updateTitle();
  updateGantt();
  setStatus('msg', 'baseline cleared');
}

// ── IndexedDB for MC results ──

function _mcDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pp-mc', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('mc'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function mcSave(projectId, data) {
  return _mcDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('mc', 'readwrite');
    tx.objectStore('mc').put(data, projectId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  })).catch(() => {});
}

function mcLoad(projectId) {
  return _mcDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('mc', 'readonly');
    const req = tx.objectStore('mc').get(projectId);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  })).catch(() => null);
}

function mcDelete(projectId) {
  return _mcDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('mc', 'readwrite');
    tx.objectStore('mc').delete(projectId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  })).catch(() => {});
}


// ── Export ──────────────────────────────────────────────────────────────────

function _planBaseName() {
  return (PP.fileName || 'plan').replace(/\.\w+$/, '');
}

const _csvEsc = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const _isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d || ''));

// The full schedule as CSV — inputs AND computed columns, one row per task.
// Opens straight in Excel/Sheets; re-imports through Import CSV.
function exportScheduleCSV() {
  if (!PP.scheduleResult) { setStatus('msg', 'nothing to export — no schedule'); return; }
  const byId = new Map(PP.scheduleResult.scheduled.map(t => [t.id, t]));
  const rows = [['ID', 'Name', 'Group', 'O', 'M', 'P', 'Depends', 'Resource', 'Progress', 'Start', 'Finish', 'Float', 'Critical']];
  for (const t of PP.tasks) {
    if (!t.id) continue;
    const sch = byId.get(t.id);
    rows.push([t.id, t.name, t.group, t.o, t.m, t.p, t.depends, t.resource, t.progress,
      sch ? _isoDay(sch.earlyStart) : '', sch ? _isoDay(sch.earlyFinish) : '',
      sch ? sch.totalFloat : '', sch && sch.isCritical ? 'yes' : '']);
  }
  const csv = rows.map(r => r.map(_csvEsc).join(',')).join('\n');
  downloadBlob(csv, _planBaseName() + '-schedule.csv', 'text/csv');
  setStatus('msg', 'exported ' + (rows.length - 1) + ' tasks as CSV');
}

// The gantt as standalone SVG — the LIBRARY renderer (print/report-ready),
// not a screenshot of the interactive one.
function exportGanttSVG() {
  if (!PP.scheduleResult) { setStatus('msg', 'nothing to export — no schedule'); return; }
  const svg = gantt(PP.scheduleResult, {
    width: 1200,
    calendar: PP.calendar,
    baseline: PP.baseline || undefined,
    deadlines: PP.deadlines && PP.deadlines.length ? PP.deadlines : undefined,
  });
  downloadBlob(svg, _planBaseName() + '-gantt.svg', 'image/svg+xml');
  setStatus('msg', 'exported gantt SVG');
}

// ── Import CSV / paste from Excel ───────────────────────────────────────────
// Header-mapped, delimiter-sniffed (tab wins if present — Excel paste is TSV).
// Recognized headers (case-insensitive): id, name, group, o/optimistic,
// m/most likely/duration, p/pessimistic, depends/predecessors, resource,
// progress/%. Unknown columns are ignored.

function _parseDelimited(text) {
  const delim = text.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const _IMPORT_HEADERS = {
  id: 'id', name: 'name', task: 'name', group: 'group', phase: 'group',
  o: 'o', optimistic: 'o', m: 'm', 'most likely': 'm', duration: 'm', dur: 'm',
  p: 'p', pessimistic: 'p',
  depends: 'depends', predecessors: 'depends', deps: 'depends', pred: 'depends',
  resource: 'resource', who: 'resource',
  progress: 'progress', '%': 'progress', 'progress %': 'progress',
};

function importTasksFromText(text, { append } = {}) {
  const rows = _parseDelimited(String(text).trim());
  if (rows.length < 2) throw new Error('need a header row + at least one task row');
  const map = rows[0].map(h => _IMPORT_HEADERS[String(h).trim().toLowerCase()] || null);
  if (!map.includes('id') && !map.includes('name')) throw new Error('no id or name column recognized in the header');
  const tasks = [];
  for (const r of rows.slice(1)) {
    const t = createTask();
    for (let i = 0; i < map.length; i++) {
      if (!map[i] || r[i] == null) continue;
      t[map[i]] = String(r[i]).trim();
    }
    if (!t.id && t.name) t.id = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (t.id || t.name) tasks.push(t);
  }
  if (!tasks.length) throw new Error('no tasks in the pasted data');
  pushUndo();
  PP.tasks = append ? [...PP.tasks.filter(x => x.id || x.name), ...tasks] : tasks;
  PP.dirty = true;
  renderRows();
  scheduleEval();
  return tasks.length;
}

function importCSVDialog() {
  const existing = $('#pp-import-dlg');
  if (existing) existing.remove();
  const dlg = document.createElement('div');
  dlg.id = 'pp-import-dlg';
  dlg.className = 'pp-window';
  dlg.style.cssText = 'left: 120px; top: 90px; width: 560px; height: 360px; display: flex; flex-direction: column;';
  dlg.innerHTML =
    '<div class="pp-win-tb"><span class="pp-win-title">IMPORT TASKS — CSV / paste from Excel</span>'
    + '<div class="pp-win-btns"><button class="pp-win-btn" id="pp-import-close">\u00d7</button></div></div>'
    + '<div class="pp-win-body" style="flex:1;display:flex;flex-direction:column;gap:6px;padding:8px">'
    + '<textarea id="pp-import-text" spellcheck="false" style="flex:1;resize:none;font:12px var(--mono);background:var(--bg0);color:var(--fg);border:1px solid var(--border);padding:6px" placeholder="paste rows here (first row = headers: id, name, group, o, m, p, depends, resource, %)\u2026 or pick a file below"></textarea>'
    + '<div style="display:flex;gap:8px;align-items:center">'
    + '<button id="pp-import-file">file\u2026</button>'
    + '<label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="pp-import-append"> append to current tasks</label>'
    + '<span style="flex:1"></span>'
    + '<button id="pp-import-go">import</button>'
    + '</div></div>';
  document.body.appendChild(dlg);
  $('#pp-import-close').onclick = () => dlg.remove();
  $('#pp-import-file').onclick = async () => {
    const f = await pickFile('.csv,.tsv,.txt');
    if (f) $('#pp-import-text').value = await f.text();
  };
  $('#pp-import-go').onclick = () => {
    try {
      const n = importTasksFromText($('#pp-import-text').value, { append: $('#pp-import-append').checked });
      dlg.remove();
      setStatus('msg', 'imported ' + n + ' tasks');
    } catch (e) {
      setStatus('msg', 'import failed: ' + e.message);
    }
  };
  $('#pp-import-text').focus();
}
