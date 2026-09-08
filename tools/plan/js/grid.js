// DOM table grid — the editable task table, DOCKED above the gantt (a
// resizable split, not a floating window: the computed half of the grid —
// %, Start, Finish, Float, ◆ — was invisible in the old 780px float).
// The templates window stays floating (it's a side editor, not the surface).

function createTaskWindow() {                 // name kept — call sites predate the dock
  const existing = $('#pp-task-pane');
  if (existing) return existing;

  const pane = document.createElement('div');
  pane.id = 'pp-task-pane';
  pane.className = 'pp-task-pane';
  const saved = parseInt(localStorage.getItem('pp-grid-height') || '', 10);
  pane.style.height = (saved >= 80 ? saved : 220) + 'px';

  const body = document.createElement('div');
  body.className = 'pp-pane-body';
  body.id = 'pp-grid-wrap';
  pane.appendChild(body);

  // the split divider — drag to resize, double-click to fit the rows
  const divider = document.createElement('div');
  divider.className = 'pp-pane-divider';
  divider.title = 'drag to resize — Ctrl+E hides the task table';
  let dragging = false, startY = 0, startH = 0;
  divider.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true; startY = e.clientY; startH = pane.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    pane.style.height = Math.max(80, Math.min(window.innerHeight - 160, startH + (e.clientY - startY))) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('pp-grid-height', String(pane.offsetHeight));
  });
  divider.addEventListener('dblclick', () => {
    const want = Math.min(window.innerHeight - 160, body.scrollHeight + 8);
    pane.style.height = Math.max(80, want) + 'px';
    localStorage.setItem('pp-grid-height', String(pane.offsetHeight));
  });
  pane.appendChild(divider);

  const main = $('#pp-main');
  main.parentNode.insertBefore(pane, main);
  return pane;
}

function toggleTaskWindow() {
  const pane = $('#pp-task-pane');
  if (!pane) return;
  pane.classList.toggle('hidden');
}

function showTaskWindow() {
  const pane = $('#pp-task-pane');
  if (pane) pane.classList.remove('hidden');
}

function buildGrid() {
  const wrap = $('#pp-grid-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  loadColumnWidths();

  const table = document.createElement('table');
  table.className = 'pp-grid';

  // Header
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  for (let ci = 0; ci < COLUMNS.length; ci++) {
    const col = COLUMNS[ci];
    const th = document.createElement('th');
    th.className = 'pp-col-' + (col.key === '#' ? 'num' : col.key === 'o' || col.key === 'm' || col.key === 'p' ? 'omp' : col.key);
    th.textContent = col.label;
    th.style.width = col.width + 'px';

    // Resize handle
    const handle = document.createElement('div');
    handle.className = 'pp-col-resize';
    handle.addEventListener('mousedown', colResizeStart(th, col, ci));
    handle.addEventListener('dblclick', e => { e.stopPropagation(); colAutoResize(th, col, ci); });
    th.appendChild(handle);

    hrow.appendChild(th);
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  tbody.id = 'pp-tbody';
  table.appendChild(tbody);

  wrap.appendChild(table);
  renderRows();
}

function colResizeStart(th, col, ci) {
  return function(e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = th.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      const w = Math.max(24, startW + ev.clientX - startX);
      th.style.width = w + 'px';
      col.width = w;
    }

    function onUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Persist column widths
      saveColumnWidths();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
}

function colAutoResize(th, col, ci) {
  const tbody = $('#pp-tbody');
  if (!tbody) return;

  // Measure header text
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;padding:0 6px;';
  probe.textContent = col.label;
  th.appendChild(probe);
  let maxW = probe.offsetWidth + 12; // padding + resize handle
  th.removeChild(probe);

  // Measure all cells in this column
  const rows = tbody.querySelectorAll('tr[data-index]');
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    const cell = cells[ci];
    if (!cell) continue;
    probe.textContent = cell.textContent;
    document.body.appendChild(probe);
    const w = probe.offsetWidth + 4;
    document.body.removeChild(probe);
    if (w > maxW) maxW = w;
  }

  maxW = Math.max(24, Math.min(maxW, 400));
  th.style.width = maxW + 'px';
  col.width = maxW;
  saveColumnWidths();
}

function saveColumnWidths() {
  const widths = {};
  for (const col of COLUMNS) widths[col.key] = col.width;
  localStorage.setItem('pp-col-widths', JSON.stringify(widths));
}

function loadColumnWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem('pp-col-widths'));
    if (!saved) return;
    for (const col of COLUMNS) {
      if (saved[col.key] != null) col.width = saved[col.key];
    }
  } catch (_) {}
}

function renderRows() {
  const tbody = $('#pp-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const scheduled = PP.scheduleResult ? PP.scheduleResult.scheduled : [];
  const schedMap = {};
  for (const s of scheduled) schedMap[s.id] = s;

  for (let i = 0; i < PP.tasks.length; i++) {
    const task = PP.tasks[i];
    const sched = schedMap[task.id];
    const tr = document.createElement('tr');
    tr.dataset.index = i;

    if (sched && sched.isCritical) tr.classList.add('pp-critical');
    if (i === PP.ui.selectedRow) tr.classList.add('pp-selected');
    const taskLinked = isLinkedTask(task);
    if (taskLinked) tr.classList.add('pp-linked-row');

    for (const col of COLUMNS) {
      const td = document.createElement('td');

      if (col.type === 'rownum') {
        td.className = 'pp-row-num';
        if (taskLinked) {
          const tpl = PP.templates.find(t => t.id === task._tpl);
          td.innerHTML = '<span class="pp-link-badge" title="Linked: ' + esc(tpl ? tpl.name : task._tpl) + '">\u25cf</span>' + (i + 1);
        } else {
          td.textContent = i + 1;
        }
        td.addEventListener('click', () => selectRow(i));
        td.addEventListener('contextmenu', e => showRowContextMenu(e, i));
      } else if (col.computed) {
        td.className = 'pp-computed';
        if (col.type === 'number') td.classList.add('pp-number');
        td.textContent = getComputedValue(task, col.key, sched);
        if (col.key === 'critical') td.className = 'pp-critical-icon pp-computed';
      } else {
        const linked = isLinkedTask(task) && isLinkedField(col.key);
        td.className = linked ? 'pp-editable pp-linked' : 'pp-editable';
        if (col.type === 'number') td.classList.add('pp-number');
        if (!linked) {
          td.contentEditable = 'true';
        }
        td.spellcheck = false;
        td.textContent = task[col.key] || '';
        td.dataset.col = col.key;
        td.dataset.row = i;

        td.addEventListener('focus', () => selectRow(i));
        if (!linked) {
          td.addEventListener('blur', e => onCellBlur(e, i, col.key));
          td.addEventListener('keydown', e => onCellKeydown(e, i, col.key));
        }
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  // Add row button
  const addTr = document.createElement('tr');
  const addTd = document.createElement('td');
  addTd.colSpan = COLUMNS.length;
  addTd.className = 'pp-add-row';
  addTd.textContent = '+ add task';
  addTd.addEventListener('click', () => {
    pushUndo();
    PP.tasks.push(createTask());
    renderRows();
    // Focus ID cell of new row
    const lastRow = PP.tasks.length - 1;
    focusCell(lastRow, 'id');
  });
  addTr.appendChild(addTd);
  tbody.appendChild(addTr);
}

function getComputedValue(task, key, sched) {
  if (!sched) return '';
  switch (key) {
    case 'start':
      return sched.earlyStart ? formatDate(sched.earlyStart) : '';
    case 'finish':
      return sched.earlyFinish ? formatDate(sched.earlyFinish) : '';
    case 'float':
      return sched.totalFloat != null ? String(Math.round(sched.totalFloat)) : '';
    case 'critical':
      return sched.isCritical ? '\u25c6' : '';
    default:
      return '';
  }
}

function formatDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function selectRow(i) {
  PP.ui.selectedRow = i;
  // Update classes without full re-render
  const rows = $$('#pp-tbody tr');
  for (const r of rows) {
    const idx = parseInt(r.dataset.index);
    if (idx === i) r.classList.add('pp-selected');
    else r.classList.remove('pp-selected');
  }
  // Scroll Gantt to show the selected task (skip if editing a cell)
  const ae = document.activeElement;
  const editing = ae && ae.contentEditable === 'true' && ae.closest('#pp-tbody');
  if (!editing) {
    const task = PP.tasks[i];
    if (task && task.id) scrollGanttToTask(task.id);
  }
}

function scrollGridToRow(i) {
  const row = $(`#pp-tbody tr[data-index="${i}"]`);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function focusCell(row, colKey) {
  requestAnimationFrame(() => {
    const cell = $(`#pp-tbody tr[data-index="${row}"] td[data-col="${colKey}"]`);
    if (cell) cell.focus();
  });
}

function onCellBlur(e, row, col) {
  const val = e.target.textContent.trim();
  const task = PP.tasks[row];
  if (!task) return;

  const oldVal = task[col] || '';
  if (val === oldVal) return;

  pushUndo();
  task[col] = val;
  PP.dirty = true;
  updateTitle();
  scheduleEval();
}

function onCellKeydown(e, row, col) {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.blur();
    // Move to next row same column
    if (row + 1 < PP.tasks.length) {
      focusCell(row + 1, col);
    } else if (row + 1 === PP.tasks.length) {
      // Add new row
      pushUndo();
      PP.tasks.push(createTask());
      renderRows();
      focusCell(row + 1, col);
    }
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    e.target.blur();
    const editableCols = COLUMNS.filter(c => c.editable);
    const idx = editableCols.findIndex(c => c.key === col);
    if (e.shiftKey) {
      if (idx > 0) focusCell(row, editableCols[idx - 1].key);
      else if (row > 0) focusCell(row - 1, editableCols[editableCols.length - 1].key);
    } else {
      if (idx < editableCols.length - 1) focusCell(row, editableCols[idx + 1].key);
      else if (row + 1 < PP.tasks.length) focusCell(row + 1, editableCols[0].key);
    }
    return;
  }

  if (e.key === 'Escape') {
    e.target.textContent = PP.tasks[row][col] || '';
    e.target.blur();
    return;
  }

  if (e.key === 'ArrowDown' && !e.target.textContent) {
    e.preventDefault();
    if (row + 1 < PP.tasks.length) focusCell(row + 1, col);
    return;
  }

  if (e.key === 'ArrowUp' && !e.target.textContent) {
    e.preventDefault();
    if (row > 0) focusCell(row - 1, col);
    return;
  }

  // Delete row with Ctrl+Delete
  if (e.key === 'Delete' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    deleteRow(row);
    return;
  }
}

function deleteRow(i) {
  if (i < 0 || i >= PP.tasks.length) return;
  pushUndo();
  PP.tasks.splice(i, 1);
  if (PP.ui.selectedRow >= PP.tasks.length) PP.ui.selectedRow = PP.tasks.length - 1;
  PP.dirty = true;
  updateTitle();
  renderRows();
  scheduleEval();
}

function insertRowAfter(i) {
  pushUndo();
  PP.tasks.splice(i + 1, 0, createTask());
  PP.dirty = true;
  updateTitle();
  renderRows();
  focusCell(i + 1, 'id');
}

function moveRow(from, to) {
  if (from === to || from < 0 || to < 0 || from >= PP.tasks.length || to >= PP.tasks.length) return;
  pushUndo();
  const [task] = PP.tasks.splice(from, 1);
  PP.tasks.splice(to, 0, task);
  PP.ui.selectedRow = to;
  PP.dirty = true;
  updateTitle();
  renderRows();
  scheduleEval();
}

function showRowContextMenu(e, row) {
  e.preventDefault();
  closeContextMenu();
  selectRow(row);

  const menu = document.createElement('div');
  menu.className = 'pp-context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  const items = [
    { label: 'Insert Row Above', action: () => { pushUndo(); PP.tasks.splice(row, 0, createTask()); PP.dirty = true; renderRows(); scheduleEval(); } },
    { label: 'Insert Row Below', action: () => insertRowAfter(row) },
    { label: 'Delete Row', action: () => deleteRow(row) },
  ];

  if (row > 0) {
    items.push({ label: 'Move Up', action: () => moveRow(row, row - 1) });
  }
  if (row < PP.tasks.length - 1) {
    items.push({ label: 'Move Down', action: () => moveRow(row, row + 1) });
  }
  if (isLinkedTask(PP.tasks[row])) {
    items.push({ label: 'Unlink from Template', action: () => unlinkTaskById(row) });
  }

  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'pp-context-entry';
    btn.textContent = item.label;
    btn.addEventListener('click', () => { closeContextMenu(); item.action(); });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  // Keep in viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

  const dismiss = (ev) => {
    if (!menu.contains(ev.target)) {
      closeContextMenu();
      document.removeEventListener('click', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

function closeContextMenu() {
  const existing = $('.pp-context-menu');
  if (existing) existing.remove();
}

// Undo/redo

function pushUndo() {
  PP.undoStack.push(JSON.stringify({ tasks: PP.tasks, templates: PP.templates }));
  if (PP.undoStack.length > 50) PP.undoStack.shift();
  PP.redoStack = [];
}

function undo() {
  if (!PP.undoStack.length) return;
  PP.redoStack.push(JSON.stringify({ tasks: PP.tasks, templates: PP.templates }));
  const snap = JSON.parse(PP.undoStack.pop());
  PP.tasks = snap.tasks || snap;
  PP.templates = snap.templates || [];
  PP.dirty = true;
  updateTitle();
  renderRows();
  scheduleEval();
}

function redo() {
  if (!PP.redoStack.length) return;
  PP.undoStack.push(JSON.stringify({ tasks: PP.tasks, templates: PP.templates }));
  const snap = JSON.parse(PP.redoStack.pop());
  PP.tasks = snap.tasks || snap;
  PP.templates = snap.templates || [];
  PP.dirty = true;
  updateTitle();
  renderRows();
  scheduleEval();
}
