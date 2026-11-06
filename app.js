/* =========================================================
   TASKFLOW – APP.JS  (v2 – debug + new features)
   Vanilla JS, no dependencies, localStorage persistence
   Sections: STATE | STORAGE | PARSER | TASKS | FILTERS |
             KANBAN | DASHBOARD | POMODORO | UI | EVENTS
   Bugs fixed:
     - quick-preview: event listeners re-stacked on every call → use once-flag + cloneNode
     - inline edit blur/Escape race: cancelled flag prevents double-save
     - drag-over child elements flicker: relatedTarget guard on dragleave
     - Kanban drop: completeTask no longer called after updateTask(done) (double mutation)
     - today-list: role="list" added programmatically
     - Escape key: only runs closeModal if modal is actually open
   New features:
     - Expand/collapse card shows full description + interactive subtask checkboxes
     - Bulk "Tandai semua selesai" button in filter bar
     - Character counter on description textarea
     - Keyboard D = done-toggle for hovered/focused card
     - Task count badge always visible (subtasks ratio chip)
     - Confirm before "Hapus Selesai" + "Tandai semua selesai"
========================================================= */

'use strict';

/* =========================================================
   STATE
========================================================= */
const STATE = {
  tasks: [],
  filter: { status: 'semua', category: 'semua', priority: 'semua', sort: 'newest', search: '' },
  view: 'list',          // 'list' | 'kanban'
  theme: 'light',
  streak: 0,
  lastStreakDate: null,
  deletedTask: null,     // for undo last delete
  dragSrcId: null,
  expandedIds: new Set(), // cards currently expanded
};

/* =========================================================
   STORAGE
========================================================= */
const STORAGE_KEY = 'taskflow_v1';
const THEME_KEY   = 'taskflow_theme';
const STREAK_KEY  = 'taskflow_streak';

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) STATE.tasks = parsed;
    }
  } catch (_) {
    STATE.tasks = [];
  }
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      STATE.streak    = d.streak   || 0;
      STATE.lastStreakDate = d.lastDate || null;
    }
  } catch (_) { /* ignore */ }
  STATE.theme = localStorage.getItem(THEME_KEY) || 'light';
}

function saveStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE.tasks));
  } catch (e) {
    showToast('Gagal menyimpan: localStorage penuh.', 'danger');
  }
}

function saveStreak() {
  localStorage.setItem(STREAK_KEY, JSON.stringify({
    streak:   STATE.streak,
    lastDate: STATE.lastStreakDate,
  }));
}

function saveTheme() {
  localStorage.setItem(THEME_KEY, STATE.theme);
}

/* =========================================================
   PARSER  –  Smart natural-language quick-add
   Parses: title, due date/time, priority, category
========================================================= */
const PRIORITY_MAP = {
  'prioritas tinggi': 'Tinggi', 'prio tinggi': 'Tinggi', 'urgent': 'Tinggi',
  'prioritas sedang': 'Sedang', 'prio sedang': 'Sedang',
  'prioritas rendah': 'Rendah', 'prio rendah': 'Rendah',
};

const CAT_TAGS = {
  '#kuliah': 'Kuliah', '#kerja': 'Kerja', '#pribadi': 'Pribadi',
  '#belanja': 'Belanja', '#lainnya': 'Lainnya',
};

/**
 * Parse natural language into task fields.
 * Returns { title, dueDate, dueTime, priority, category }
 */
function parseQuickAdd(raw) {
  let text = raw.trim();
  const result = {
    title: '', dueDate: '', dueTime: '',
    priority: 'Sedang', category: 'Lainnya',
  };

  // --- CATEGORY (#tag) ---
  const catMatch = text.match(/#([a-zA-Z]+)/i);
  if (catMatch) {
    const tag = ('#' + catMatch[1]).toLowerCase();
    if (CAT_TAGS[tag]) result.category = CAT_TAGS[tag];
    text = text.replace(catMatch[0], '').trim();
  }

  // --- PRIORITY (longest phrase first to avoid partial match) ---
  const sortedPrio = Object.entries(PRIORITY_MAP)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, val] of sortedPrio) {
    const re = new RegExp(phrase, 'i');
    if (re.test(text)) {
      result.priority = val;
      text = text.replace(re, '').trim();
      break;
    }
  }

  // --- TIME: jam HH or jam HH:MM ---
  const timeMatch = text.match(/jam\s+(\d{1,2})(?::(\d{2}))?/i);
  if (timeMatch) {
    const h = timeMatch[1].padStart(2, '0');
    const m = timeMatch[2] ? timeMatch[2].padStart(2, '0') : '00';
    result.dueTime = `${h}:${m}`;
    text = text.replace(timeMatch[0], '').trim();
  }

  // --- DATE keywords ---
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const lusa     = new Date(now); lusa.setDate(now.getDate() + 2);

  if (/\bbesok\b/i.test(text)) {
    result.dueDate = fmtDate(tomorrow);
    text = text.replace(/\bbesok\b/i, '').trim();
  } else if (/\blusa\b/i.test(text)) {
    result.dueDate = fmtDate(lusa);
    text = text.replace(/\blusa\b/i, '').trim();
  } else if (/\bhari ini\b/i.test(text)) {
    result.dueDate = fmtDate(now);
    text = text.replace(/\bhari ini\b/i, '').trim();
  } else {
    const tglMatch = text.match(/(?:tgl|tanggal)\s+(\d{1,2})/i);
    if (tglMatch) {
      const day = parseInt(tglMatch[1], 10);
      if (day >= 1 && day <= 31) {
        const y  = now.getFullYear();
        const mo = String(now.getMonth() + 1).padStart(2, '0');
        result.dueDate = `${y}-${mo}-${String(day).padStart(2, '0')}`;
      }
      text = text.replace(tglMatch[0], '').trim();
    }
  }

  // Clean trailing punctuation / extra spaces
  text = text.replace(/\s{2,}/g, ' ').replace(/^[-–,;:]+|[-–,;:]+$/g, '').trim();
  result.title = text || raw.trim();
  return result;
}

/* =========================================================
   DATE HELPERS
========================================================= */
function fmtDate(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function fmtDateDisplay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${d} ${months[m - 1]} ${y}`;
}

/* =========================================================
   TASKS
========================================================= */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function createTask(fields) {
  return {
    id:          generateId(),
    title:       sanitize(fields.title       || ''),
    description: sanitize(fields.description || ''),
    category:    fields.category    || 'Lainnya',
    priority:    fields.priority    || 'Sedang',
    dueDate:     fields.dueDate     || '',
    dueTime:     fields.dueTime     || '',
    recur:       fields.recur       || 'none',
    kanbanStatus:fields.kanbanStatus|| 'todo',
    done:        false,
    createdAt:   Date.now(),
    completedAt: null,
    subtasks: (fields.subtasks || []).map(s => ({
      id:    generateId(),
      title: sanitize(typeof s === 'string' ? s : s.title || ''),
      done:  s.done || false,
    })),
  };
}

function addTask(fields) {
  const t = createTask(fields);
  STATE.tasks.unshift(t);
  saveStorage();
  return t;
}

function updateTask(id, fields) {
  const t = STATE.tasks.find(t => t.id === id);
  if (!t) return;
  if ('title'        in fields) t.title        = sanitize(fields.title);
  if ('description'  in fields) t.description  = sanitize(fields.description);
  if ('category'     in fields) t.category     = fields.category;
  if ('priority'     in fields) t.priority     = fields.priority;
  if ('dueDate'      in fields) t.dueDate      = fields.dueDate;
  if ('dueTime'      in fields) t.dueTime      = fields.dueTime;
  if ('recur'        in fields) t.recur        = fields.recur;
  if ('kanbanStatus' in fields) t.kanbanStatus = fields.kanbanStatus;
  if ('subtasks'     in fields) t.subtasks     = fields.subtasks.map(s => ({
    id:    s.id || generateId(),
    title: sanitize(s.title || ''),
    done:  Boolean(s.done),
  }));
  if ('done' in fields) {
    t.done        = Boolean(fields.done);
    t.completedAt = fields.done ? Date.now() : null;
    if (fields.done  && t.kanbanStatus !== 'done') t.kanbanStatus = 'done';
    if (!fields.done && t.kanbanStatus === 'done') t.kanbanStatus = 'todo';
  }
  saveStorage();
}

function deleteTask(id) {
  const idx = STATE.tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  STATE.deletedTask = { task: JSON.parse(JSON.stringify(STATE.tasks[idx])), idx };
  STATE.tasks.splice(idx, 1);
  STATE.expandedIds.delete(id);
  saveStorage();
}

function undoDelete() {
  if (!STATE.deletedTask) return;
  const { task, idx } = STATE.deletedTask;
  STATE.tasks.splice(Math.min(idx, STATE.tasks.length), 0, task);
  STATE.deletedTask = null;
  saveStorage();
  renderAll();
}

/** Mark done and handle recurrence */
function completeTask(id) {
  // snapshot BEFORE mutating
  const snap = STATE.tasks.find(t => t.id === id);
  if (!snap) return;
  const recur   = snap.recur;
  const dueDate = snap.dueDate;
  const title   = snap.title;

  updateTask(id, { done: true });
  updateStreak();

  if (recur && recur !== 'none' && dueDate) {
    const nextDate = calcNextRecur(dueDate, recur);
    const newTask  = createTask({
      title:       snap.title,
      description: snap.description,
      category:    snap.category,
      priority:    snap.priority,
      dueDate:     nextDate,
      dueTime:     snap.dueTime,
      recur:       recur,
      kanbanStatus:'todo',
      subtasks:    snap.subtasks.map(s => ({ title: s.title, done: false })),
    });
    STATE.tasks.unshift(newTask);
    saveStorage();
    showToast(`Tugas berulang dibuat: ${title}`, 'success');
  }
}

function calcNextRecur(dateStr, recur) {
  const d = new Date(dateStr + 'T12:00:00');
  if (recur === 'daily')   d.setDate(d.getDate() + 1);
  if (recur === 'weekly')  d.setDate(d.getDate() + 7);
  if (recur === 'monthly') d.setMonth(d.getMonth() + 1);
  return fmtDate(d);
}

function updateStreak() {
  const today     = fmtDate(new Date());
  const yesterday = fmtDate(new Date(Date.now() - 86400000));
  if (STATE.lastStreakDate === today) return;
  STATE.streak = (STATE.lastStreakDate === yesterday || STATE.lastStreakDate === null)
    ? STATE.streak + 1 : 1;
  STATE.lastStreakDate = today;
  saveStreak();
}

/* =========================================================
   FILTERS
========================================================= */
function getFilteredTasks() {
  const { status, category, priority, sort, search } = STATE.filter;
  let tasks = [...STATE.tasks];

  if (search) {
    const q = search.toLowerCase();
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    );
  }
  if (status !== 'semua') tasks = tasks.filter(t => status === 'aktif' ? !t.done : t.done);
  if (category !== 'semua') tasks = tasks.filter(t => t.category === category);
  if (priority !== 'semua') tasks = tasks.filter(t => t.priority === priority);

  const priOrd = { Tinggi: 0, Sedang: 1, Rendah: 2 };
  if (sort === 'priority') {
    tasks.sort((a, b) => (priOrd[a.priority] ?? 1) - (priOrd[b.priority] ?? 1));
  } else if (sort === 'duedate') {
    tasks.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  } else {
    tasks.sort((a, b) => b.createdAt - a.createdAt);
  }
  return tasks;
}

function getDueStatus(task) {
  if (!task.dueDate) return 'none';
  const today = fmtDate(new Date());
  if (task.dueDate < today)  return 'overdue';
  if (task.dueDate === today) return 'today';
  return 'future';
}

/* =========================================================
   KANBAN
========================================================= */
function renderKanban() {
  const tasks = getFilteredTasks();
  const cols = { todo: [], inprogress: [], done: [] };
  tasks.forEach(t => {
    const s = t.kanbanStatus || 'todo';
    if (cols[s]) cols[s].push(t);
  });

  Object.entries(cols).forEach(([status, list]) => {
    const col = document.querySelector(`#kanban-${status} .kanban-items`);
    if (!col) return;
    col.innerHTML = '';
    list.forEach(t => col.appendChild(buildKanbanCard(t)));
  });
}

function buildKanbanCard(task) {
  const div = document.createElement('div');
  div.className = 'task-card';
  div.dataset.id = task.id;
  div.setAttribute('data-priority', task.priority);
  div.setAttribute('role', 'listitem');
  div.setAttribute('tabindex', '0');
  div.setAttribute('draggable', 'true');

  const ds = getDueStatus(task);
  if (!task.done && ds === 'overdue') div.classList.add('overdue');
  if (!task.done && ds === 'today')   div.classList.add('due-today');
  if (task.done) div.classList.add('done');

  const subs    = task.subtasks || [];
  const subDone = subs.filter(s => s.done).length;
  const subChip = subs.length
    ? `<span class="badge badge-sub">${subDone}/${subs.length} ✓</span>` : '';

  div.innerHTML = `
    <div class="task-body">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-meta">
        <span class="badge badge-prio-${task.priority}">${task.priority}</span>
        <span class="badge badge-cat">${catEmoji(task.category)} ${task.category}</span>
        ${subChip}
        ${task.dueDate ? `<span class="badge badge-due ${ds === 'overdue' ? 'overdue' : ds === 'today' ? 'due-today' : ''}">
          📅 ${fmtDateDisplay(task.dueDate)}${task.dueTime ? ' ' + task.dueTime : ''}</span>` : ''}
      </div>
    </div>
    <div class="task-actions">
      <button class="task-action-btn" data-action="edit"   aria-label="Edit tugas">✏️</button>
      <button class="task-action-btn del" data-action="delete" aria-label="Hapus tugas">🗑️</button>
    </div>
  `;

  div.addEventListener('dragstart', onKanbanDragStart);
  div.addEventListener('dragend',   onKanbanDragEnd);

  div.querySelector('[data-action="edit"]').addEventListener('click', e => {
    e.stopPropagation(); openTaskModal(task.id);
  });
  div.querySelector('[data-action="delete"]').addEventListener('click', e => {
    e.stopPropagation(); confirmDelete(task.id);
  });
  return div;
}

function onKanbanDragStart(e) {
  STATE.dragSrcId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function onKanbanDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
}

/* =========================================================
   DASHBOARD
========================================================= */
function updateDashboard() {
  const total    = STATE.tasks.length;
  const today    = fmtDate(new Date());
  const doneToday = STATE.tasks.filter(t =>
    t.done && t.completedAt && fmtDate(new Date(t.completedAt)) === today
  ).length;
  const doneAll  = STATE.tasks.filter(t => t.done).length;
  const pct      = total === 0 ? 0 : Math.round(doneAll / total * 100);

  document.getElementById('stat-total').textContent     = total;
  document.getElementById('stat-done-today').textContent = doneToday;
  document.getElementById('stat-streak').textContent    = STATE.streak;

  // Completion ring (circumference = 2π×32 ≈ 201.06)
  const C      = 2 * Math.PI * 32;
  const offset = C - (pct / 100) * C;
  const ring   = document.getElementById('ring-fill');
  ring.style.strokeDasharray  = C;
  ring.style.strokeDashoffset = offset;
  document.getElementById('ring-pct').textContent = pct + '%';

  // Bar chart – per category
  const cats = ['Kuliah','Kerja','Pribadi','Belanja','Lainnya'];
  const max  = Math.max(...cats.map(c => STATE.tasks.filter(t => t.category === c).length), 1);
  const chart = document.getElementById('bar-chart');
  chart.innerHTML = '';
  cats.forEach(cat => {
    const count  = STATE.tasks.filter(t => t.category === cat).length;
    const pctBar = Math.round(count / max * 100);
    const row    = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <span class="bar-label">${escapeHtml(cat)}</span>
      <div class="bar-track" role="progressbar"
           aria-valuenow="${count}" aria-valuemin="0" aria-valuemax="${max}"
           aria-label="${escapeHtml(cat)}">
        <div class="bar-fill" style="width:${pctBar}%"></div>
      </div>
      <span class="bar-count">${count}</span>
    `;
    chart.appendChild(row);
  });
}

/* =========================================================
   POMODORO
========================================================= */
const POMO = {
  mode:  'focus',
  timeLeft: 25 * 60,
  running:  false,
  interval: null,
  attachedTaskId: null,
  FOCUS_SECS: 25 * 60,
  BREAK_SECS:  5 * 60,
};

function pomoClear() {
  clearInterval(POMO.interval);
  POMO.interval = null;
  POMO.running  = false;
}

function pomoReset() {
  pomoClear();
  POMO.mode     = 'focus';
  POMO.timeLeft = POMO.FOCUS_SECS;
  renderPomo();
}

function pomoStart() {
  if (POMO.running) return;
  POMO.running = true;
  POMO.interval = setInterval(() => {
    POMO.timeLeft--;
    if (POMO.timeLeft <= 0) { pomoClear(); onPomoEnd(); }
    else renderPomo();
  }, 1000);
  renderPomo();
}

function pomoPause() {
  pomoClear();
  renderPomo();
}

function onPomoEnd() {
  const wasBreak = POMO.mode === 'break';
  POMO.mode     = wasBreak ? 'focus' : 'break';
  POMO.timeLeft = wasBreak ? POMO.FOCUS_SECS : POMO.BREAK_SECS;
  renderPomo();

  const flash = document.getElementById('pomo-flash');
  flash.className = 'pomo-flash ' + (wasBreak ? 'focus' : 'break');
  setTimeout(() => { flash.className = 'pomo-flash'; }, 3100);

  showToast(wasBreak ? '☀️ Waktu fokus dimulai!' : '☕ Istirahat sejenak! Kerja bagus!', 'success');
}

function renderPomo() {
  const mins = String(Math.floor(POMO.timeLeft / 60)).padStart(2, '0');
  const secs = String(POMO.timeLeft % 60).padStart(2, '0');
  document.getElementById('pomo-display').textContent = `${mins}:${secs}`;
  document.getElementById('pomo-mode').textContent    = POMO.mode === 'focus' ? 'Fokus 🎯' : 'Istirahat ☕';
  document.getElementById('btn-pomo-start').disabled  = POMO.running;
  document.getElementById('btn-pomo-pause').disabled  = !POMO.running;
}

function attachTaskToPomo(taskId) {
  const t = STATE.tasks.find(t => t.id === taskId);
  if (!t) return;
  POMO.attachedTaskId = taskId;
  document.getElementById('pomo-task-label').textContent = t.title;
  document.getElementById('pomodoro-widget').style.display = '';
  document.getElementById('btn-open-pomo').style.display   = 'none';
  showToast(`Timer dikaitkan ke: ${t.title}`, 'success');
}

/* =========================================================
   UI – Rendering
========================================================= */
function renderAll() {
  renderTaskList();
  if (STATE.view === 'kanban') renderKanban();
  updateDashboard();
}

function renderTaskList() {
  const tasks    = getFilteredTasks();
  const todayStr = fmtDate(new Date());

  const todayTasks = tasks.filter(t => !t.done && t.dueDate === todayStr);
  const otherTasks = tasks.filter(t => !(t.dueDate === todayStr && !t.done));

  const todaySection = document.getElementById('today-section');
  const todayList    = document.getElementById('today-list');
  const taskList     = document.getElementById('task-list');
  const emptyState   = document.getElementById('empty-state');

  todayList.innerHTML = '';
  taskList.innerHTML  = '';

  if (todayTasks.length > 0) {
    todaySection.classList.remove('hidden');
    todayTasks.forEach(t => todayList.appendChild(buildTaskCard(t)));
  } else {
    todaySection.classList.add('hidden');
  }

  otherTasks.forEach(t => taskList.appendChild(buildTaskCard(t)));
  emptyState.classList.toggle('hidden', tasks.length > 0);
}

/* ---- build one task card ---- */
function buildTaskCard(task) {
  const div = document.createElement('div');
  div.className = 'task-card';
  div.dataset.id = task.id;
  div.setAttribute('data-priority', task.priority);
  div.setAttribute('role', 'listitem');
  div.setAttribute('tabindex', '0');
  div.setAttribute('draggable', 'true');

  const ds = getDueStatus(task);
  if (!task.done && ds === 'overdue') div.classList.add('overdue');
  if (!task.done && ds === 'today')   div.classList.add('due-today');
  if (task.done) div.classList.add('done');

  const isExpanded = STATE.expandedIds.has(task.id);
  if (isExpanded) div.classList.add('expanded');

  // Subtasks
  const subs    = task.subtasks || [];
  const subDone = subs.filter(s => s.done).length;
  const subPct  = subs.length ? Math.round(subDone / subs.length * 100) : 0;

  // Sub progress chip (always visible if subtasks exist)
  const subChip = subs.length
    ? `<span class="badge badge-sub" title="${subDone} dari ${subs.length} subtugas selesai">${subDone}/${subs.length} ✓</span>`
    : '';

  const recurChip = task.recur !== 'none'
    ? `<span class="badge badge-recur">🔁 ${recurLabel(task.recur)}</span>` : '';

  // Expanded body: description + interactive subtasks
  let expandedHtml = '';
  if (isExpanded) {
    const descHtml = task.description
      ? `<div class="card-desc-full">${escapeHtml(task.description)}</div>` : '';
    const subsHtml = subs.length ? `
      <div class="card-subtasks">
        <div class="card-subtasks-bar">
          <div class="subtask-mini-bar">
            <div class="subtask-mini-fill" style="width:${subPct}%"></div>
          </div>
          <span class="subtask-progress">${subDone}/${subs.length}</span>
        </div>
        ${subs.map((s, i) => `
          <label class="card-sub-item${s.done ? ' done' : ''}">
            <input type="checkbox" class="card-sub-chk" data-sub-idx="${i}" ${s.done ? 'checked' : ''}
                   aria-label="${escapeHtml(s.title)}" />
            <span>${escapeHtml(s.title)}</span>
          </label>
        `).join('')}
      </div>` : '';
    expandedHtml = `<div class="card-expand-body">${descHtml}${subsHtml}</div>`;
  }

  div.innerHTML = `
    <div class="task-checkbox-wrap">
      <input type="checkbox" class="task-checkbox" id="chk-${task.id}"
             ${task.done ? 'checked' : ''}
             aria-label="Tandai selesai: ${escapeHtml(task.title)}" />
    </div>
    <div class="task-body">
      <div class="task-title-row">
        <span class="task-title" tabindex="0"
              title="Klik dua kali untuk edit inline">${escapeHtml(task.title)}</span>
        <button class="task-expand-btn icon-btn"
                aria-label="${isExpanded ? 'Tutup' : 'Buka'} detail tugas"
                aria-expanded="${isExpanded}">${isExpanded ? '▲' : '▼'}</button>
      </div>
      <div class="task-meta">
        <span class="badge badge-prio-${task.priority}">${task.priority}</span>
        <span class="badge badge-cat">${catEmoji(task.category)} ${task.category}</span>
        ${task.dueDate ? `<span class="badge badge-due ${ds === 'overdue' ? 'overdue' : ds === 'today' ? 'due-today' : ''}">
          📅 ${fmtDateDisplay(task.dueDate)}${task.dueTime ? ' ' + task.dueTime : ''}${ds === 'overdue' ? ' ⚠️' : ds === 'today' ? ' ⏰' : ''}</span>` : ''}
        ${subChip}
        ${recurChip}
      </div>
      ${expandedHtml}
    </div>
    <div class="task-actions" role="group" aria-label="Aksi tugas">
      <button class="task-action-btn" data-action="edit"
              aria-label="Edit tugas: ${escapeHtml(task.title)}">✏️</button>
      <button class="task-action-btn pomo" data-action="pomo"
              aria-label="Pomodoro untuk: ${escapeHtml(task.title)}">🍅</button>
      <button class="task-action-btn del" data-action="delete"
              aria-label="Hapus tugas: ${escapeHtml(task.title)}">🗑️</button>
    </div>
  `;

  // — Checkbox done toggle
  const chk = div.querySelector('.task-checkbox');
  chk.addEventListener('change', () => {
    if (chk.checked) completeTask(task.id);
    else              updateTask(task.id, { done: false });
    renderAll();
  });

  // — Expand/collapse button
  div.querySelector('.task-expand-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleExpand(task.id);
  });

  // — Inline subtask checkboxes (only rendered when expanded)
  div.querySelectorAll('.card-sub-chk').forEach(subChkEl => {
    subChkEl.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.subIdx, 10);
      const newSubs = task.subtasks.map((s, i) =>
        i === idx ? { ...s, done: e.target.checked } : s
      );
      updateTask(task.id, { subtasks: newSubs });
      // Re-render only this card's expand body (avoid full re-render)
      renderAll();
    });
  });

  // — Inline title edit: double-click or Enter on title span
  const titleEl = div.querySelector('.task-title');
  titleEl.addEventListener('dblclick', () => startInlineEdit(task.id, titleEl));
  titleEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); startInlineEdit(task.id, titleEl); }
  });

  // — Action buttons
  div.querySelector('[data-action="edit"]').addEventListener('click', e => {
    e.stopPropagation(); openTaskModal(task.id);
  });
  div.querySelector('[data-action="pomo"]').addEventListener('click', e => {
    e.stopPropagation(); attachTaskToPomo(task.id);
  });
  div.querySelector('[data-action="delete"]').addEventListener('click', e => {
    e.stopPropagation(); confirmDelete(task.id);
  });

  // — Drag and drop (list view reorder)
  div.addEventListener('dragstart', onListDragStart);
  div.addEventListener('dragover',  onListDragOver);
  div.addEventListener('dragleave', onListDragLeave);
  div.addEventListener('drop',      onListDrop);
  div.addEventListener('dragend',   onListDragEnd);

  return div;
}

function toggleExpand(id) {
  if (STATE.expandedIds.has(id)) STATE.expandedIds.delete(id);
  else                            STATE.expandedIds.add(id);
  renderAll();
}

function recurLabel(r) {
  return { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan' }[r] || r;
}

/* ---- Inline edit ---- */
function startInlineEdit(id, titleEl) {
  const task = STATE.tasks.find(t => t.id === id);
  if (!task) return;

  let saved = false; // FIX: prevent double-save from blur + Enter race

  const input = document.createElement('input');
  input.type      = 'text';
  input.value     = task.title;
  input.className = 'task-title-edit';
  input.setAttribute('aria-label', 'Edit judul tugas');
  input.maxLength = 200;

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const save = () => {
    if (saved) return;
    saved = true;
    const val = input.value.trim();
    if (val && val !== task.title) updateTask(id, { title: val });
    renderAll();
  };

  const cancel = () => {
    if (saved) return;
    saved = true;
    renderAll();
  };

  input.addEventListener('blur',    save);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

/* =========================================================
   TASK MODAL
========================================================= */
let _modalSubtasks = [];

function openTaskModal(taskId) {
  const modal = document.getElementById('task-modal');
  document.getElementById('modal-title').textContent = taskId ? 'Edit Tugas' : 'Tugas Baru';
  document.getElementById('task-id').value           = taskId || '';
  document.getElementById('err-title').textContent   = '';

  const task = taskId ? STATE.tasks.find(t => t.id === taskId) : null;

  document.getElementById('task-title').value          = task ? task.title       : '';
  document.getElementById('task-desc').value           = task ? task.description : '';
  document.getElementById('task-category').value       = task ? task.category    : 'Lainnya';
  document.getElementById('task-priority').value       = task ? task.priority    : 'Sedang';
  document.getElementById('task-due-date').value       = task ? task.dueDate     : '';
  document.getElementById('task-due-time').value       = task ? task.dueTime     : '';
  document.getElementById('task-recur').value          = task ? task.recur       : 'none';
  document.getElementById('task-kanban-status').value  = task ? (task.kanbanStatus || 'todo') : 'todo';

  _modalSubtasks = task ? task.subtasks.map(s => ({ ...s })) : [];
  renderModalSubtasks();
  updateDescCounter();

  modal.classList.remove('hidden');
  document.getElementById('task-title').focus();
  trapFocus(modal);
}

function closeTaskModal() {
  const modal = document.getElementById('task-modal');
  if (modal.classList.contains('hidden')) return; // already closed – FIX: avoid spurious releaseFocus
  modal.classList.add('hidden');
  releaseFocus();
}

function renderModalSubtasks() {
  const list = document.getElementById('subtask-list');
  list.innerHTML = '';
  _modalSubtasks.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'subtask-item' + (s.done ? ' done' : '');
    item.innerHTML = `
      <input type="checkbox" id="msub-${i}" ${s.done ? 'checked' : ''}
             aria-label="Subtugas: ${escapeHtml(s.title)}" />
      <label for="msub-${i}">${escapeHtml(s.title)}</label>
      <button type="button" class="subtask-remove icon-btn" aria-label="Hapus subtugas ${escapeHtml(s.title)}">✕</button>
    `;
    item.querySelector('input').addEventListener('change', ev => {
      _modalSubtasks[i].done = ev.target.checked;
      item.classList.toggle('done', ev.target.checked);
    });
    item.querySelector('.subtask-remove').addEventListener('click', () => {
      _modalSubtasks.splice(i, 1);
      renderModalSubtasks();
    });
    list.appendChild(item);
  });
}

function updateDescCounter() {
  const ta  = document.getElementById('task-desc');
  const ctr = document.getElementById('desc-counter');
  if (!ta || !ctr) return;
  const len = ta.value.length;
  ctr.textContent = `${len}/1000`;
  ctr.classList.toggle('over', len > 900);
}

function saveTaskFromModal() {
  const id    = document.getElementById('task-id').value;
  const title = document.getElementById('task-title').value.trim();
  const errEl = document.getElementById('err-title');

  if (!title) {
    errEl.textContent = 'Judul tidak boleh kosong.';
    document.getElementById('task-title').focus();
    return;
  }
  errEl.textContent = '';

  const fields = {
    title,
    description:  document.getElementById('task-desc').value.trim(),
    category:     document.getElementById('task-category').value,
    priority:     document.getElementById('task-priority').value,
    dueDate:      document.getElementById('task-due-date').value,
    dueTime:      document.getElementById('task-due-time').value,
    recur:        document.getElementById('task-recur').value,
    kanbanStatus: document.getElementById('task-kanban-status').value,
    subtasks:     _modalSubtasks,
  };

  if (id) {
    updateTask(id, fields);
    showToast('Tugas diperbarui.', 'success');
  } else {
    addTask(fields);
    showToast('Tugas ditambahkan!', 'success');
  }
  closeTaskModal();
  renderAll();
}

/* =========================================================
   DELETE CONFIRM MODAL
========================================================= */
let _pendingDeleteId = null;

function confirmDelete(id) {
  const task = STATE.tasks.find(t => t.id === id);
  if (!task) return;
  _pendingDeleteId = id;
  document.getElementById('confirm-msg').textContent =
    `Hapus "${task.title}"? Tindakan ini bisa diurungkan dalam 8 detik.`;
  const modal = document.getElementById('confirm-modal');
  modal.classList.remove('hidden');
  document.getElementById('btn-confirm-ok').focus();
  trapFocus(modal);
}

function closeConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  _pendingDeleteId = null;
  releaseFocus();
}

function executeDelete() {
  if (!_pendingDeleteId) return;
  const task = STATE.tasks.find(t => t.id === _pendingDeleteId);
  const title = task ? task.title : '';
  deleteTask(_pendingDeleteId);
  closeConfirmModal();
  renderAll();
  showToast(`"${title}" dihapus.`, 'danger', {
    label: 'Urungkan',
    action: () => { undoDelete(); showToast('Penghapusan diurungkan.', 'success'); },
  });
}

/* =========================================================
   QUICK-ADD  (FIX: each call creates fresh listener nodes)
========================================================= */
let _quickParsed = null;

function handleQuickAdd() {
  const raw = document.getElementById('quick-add-input').value.trim();
  if (!raw) return;

  _quickParsed = parseQuickAdd(raw);

  const preview = document.getElementById('quick-preview');
  const clarify = document.getElementById('quick-clarify');

  // Build fresh preview DOM (no lingering event listeners)
  const chips = [
    `<span class="preview-chip">📝 ${escapeHtml(_quickParsed.title || '(kosong)')}</span>`,
    _quickParsed.dueDate
      ? `<span class="preview-chip">📅 ${fmtDateDisplay(_quickParsed.dueDate)}${_quickParsed.dueTime ? ' ' + _quickParsed.dueTime : ''}</span>`
      : '',
    `<span class="preview-chip">⚡ ${_quickParsed.priority}</span>`,
    `<span class="preview-chip">${catEmoji(_quickParsed.category)} ${_quickParsed.category}</span>`,
  ].filter(Boolean).join('');

  preview.innerHTML = chips; // chips only – no buttons yet (avoid re-attachment)

  // Create action buttons fresh to avoid stacking listeners
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'preview-actions';

  const btnConfirm = document.createElement('button');
  btnConfirm.className   = 'btn-primary';
  btnConfirm.textContent = '✓ Konfirmasi';
  btnConfirm.setAttribute('aria-label', 'Konfirmasi tambah tugas');
  btnConfirm.addEventListener('click', () => {
    addTask(_quickParsed);
    document.getElementById('quick-add-input').value = '';
    preview.classList.add('hidden');
    clarify.classList.add('hidden');
    _quickParsed = null;
    renderAll();
    showToast('Tugas ditambahkan via quick-add!', 'success');
  }, { once: true });

  const btnEdit = document.createElement('button');
  btnEdit.className   = 'btn-secondary';
  btnEdit.textContent = '✎ Edit';
  btnEdit.setAttribute('aria-label', 'Edit sebelum simpan');
  btnEdit.addEventListener('click', () => {
    openModalFromParsed(_quickParsed);
    document.getElementById('quick-add-input').value = '';
    preview.classList.add('hidden');
    clarify.classList.add('hidden');
    _quickParsed = null;
  }, { once: true });

  const btnCancel = document.createElement('button');
  btnCancel.className   = 'btn-secondary';
  btnCancel.textContent = '✕';
  btnCancel.setAttribute('aria-label', 'Batal');
  btnCancel.addEventListener('click', () => {
    preview.classList.add('hidden');
    clarify.classList.add('hidden');
    _quickParsed = null;
  }, { once: true });

  actionsDiv.append(btnConfirm, btnEdit, btnCancel);
  preview.appendChild(actionsDiv);
  preview.classList.remove('hidden');
  clarify.classList.add('hidden');

  if (!_quickParsed.title || _quickParsed.title.length < 2) {
    clarify.textContent = '❓ Tidak dapat mengekstrak judul. Coba tulis ulang dengan judul yang lebih jelas.';
    clarify.classList.remove('hidden');
  }
}

function openModalFromParsed(parsed) {
  openTaskModal(null);
  document.getElementById('task-title').value    = parsed.title;
  document.getElementById('task-category').value = parsed.category;
  document.getElementById('task-priority').value = parsed.priority;
  document.getElementById('task-due-date').value = parsed.dueDate;
  document.getElementById('task-due-time').value = parsed.dueTime;
}

/* =========================================================
   DRAG & DROP – LIST VIEW
   FIX: dragleave uses relatedTarget to prevent child-element flicker
========================================================= */
function onListDragStart(e) {
  STATE.dragSrcId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onListDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onListDragLeave(e) {
  // Only remove class when truly leaving the card, not entering a child
  if (e.currentTarget.contains(e.relatedTarget)) return;
  e.currentTarget.classList.remove('drag-over');
}

function onListDrop(e) {
  e.preventDefault();
  const srcId = STATE.dragSrcId;
  const tgtId = e.currentTarget.dataset.id;
  if (!srcId || srcId === tgtId) return;
  e.currentTarget.classList.remove('drag-over');

  const srcIdx = STATE.tasks.findIndex(t => t.id === srcId);
  const tgtIdx = STATE.tasks.findIndex(t => t.id === tgtId);
  if (srcIdx === -1 || tgtIdx === -1) return;

  const [moved] = STATE.tasks.splice(srcIdx, 1);
  STATE.tasks.splice(tgtIdx, 0, moved);
  saveStorage();
  renderAll();
}

function onListDragEnd(e) {
  e.currentTarget.classList.remove('dragging', 'drag-over');
  STATE.dragSrcId = null;
}

/* =========================================================
   DRAG & DROP – KANBAN COLUMNS
   FIX: completeTask is NOT called on kanban drop (updateTask handles done flag)
========================================================= */
function initKanbanDrop() {
  document.querySelectorAll('.kanban-items').forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      col.closest('.kanban-col').classList.add('drag-over-col');
    });
    col.addEventListener('dragleave', e => {
      if (col.contains(e.relatedTarget)) return;
      col.closest('.kanban-col').classList.remove('drag-over-col');
    });
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.closest('.kanban-col').classList.remove('drag-over-col');
      const newStatus = col.closest('.kanban-col').dataset.status;
      if (!STATE.dragSrcId || !newStatus) return;

      const isDone = newStatus === 'done';
      // update kanbanStatus + done in one call to avoid double-save
      updateTask(STATE.dragSrcId, {
        kanbanStatus: newStatus,
        done: isDone,
      });
      if (isDone) updateStreak();
      renderAll();
    });
  });
}

/* =========================================================
   DATA TOOLS
========================================================= */
function exportJSON() {
  const json = JSON.stringify(STATE.tasks, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `taskflow-${fmtDate(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Data berhasil diekspor!', 'success');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Bukan array');
      STATE.tasks = data.map(t => ({
        id:           String(t.id || generateId()),
        title:        sanitize(String(t.title || '')),
        description:  sanitize(String(t.description || '')),
        category:     ['Kuliah','Kerja','Pribadi','Belanja','Lainnya'].includes(t.category) ? t.category : 'Lainnya',
        priority:     ['Rendah','Sedang','Tinggi'].includes(t.priority) ? t.priority : 'Sedang',
        dueDate:      String(t.dueDate || ''),
        dueTime:      String(t.dueTime || ''),
        recur:        ['none','daily','weekly','monthly'].includes(t.recur) ? t.recur : 'none',
        kanbanStatus: ['todo','inprogress','done'].includes(t.kanbanStatus) ? t.kanbanStatus : 'todo',
        done:         Boolean(t.done),
        createdAt:    Number(t.createdAt) || Date.now(),
        completedAt:  t.completedAt ? Number(t.completedAt) : null,
        subtasks:     Array.isArray(t.subtasks) ? t.subtasks.map(s => ({
          id:    String(s.id || generateId()),
          title: sanitize(String(s.title || '')),
          done:  Boolean(s.done),
        })) : [],
      }));
      saveStorage();
      renderAll();
      showToast(`${STATE.tasks.length} tugas berhasil diimpor!`, 'success');
    } catch (_) {
      showToast('Gagal impor: format file tidak valid.', 'danger');
    }
  };
  reader.readAsText(file);
}

function clearDoneTasks() {
  const count = STATE.tasks.filter(t => t.done).length;
  if (!count) { showToast('Tidak ada tugas selesai.', 'info'); return; }
  if (!window.confirm(`Hapus ${count} tugas selesai?`)) return;
  STATE.tasks = STATE.tasks.filter(t => !t.done);
  saveStorage();
  renderAll();
  showToast(`${count} tugas selesai dihapus.`, 'success');
}

function markAllDone() {
  const active = STATE.tasks.filter(t => !t.done);
  if (!active.length) { showToast('Semua tugas sudah selesai.', 'info'); return; }
  if (!window.confirm(`Tandai ${active.length} tugas sebagai selesai?`)) return;
  active.forEach(t => {
    t.done        = true;
    t.completedAt = Date.now();
    t.kanbanStatus = 'done';
  });
  saveStorage();
  updateStreak();
  renderAll();
  showToast(`${active.length} tugas ditandai selesai!`, 'success');
}

function resetAllData() {
  if (!window.confirm('Reset semua data? Semua tugas akan dihapus dan diganti dengan data contoh.')) return;
  STATE.tasks         = [];
  STATE.streak        = 0;
  STATE.lastStreakDate = null;
  STATE.deletedTask   = null;
  STATE.expandedIds.clear();
  saveStorage();
  saveStreak();
  loadDummyTasks();
  renderAll();
  showToast('Data direset ke contoh awal.', 'warning');
}

/* =========================================================
   DUMMY DATA
========================================================= */
function loadDummyTasks() {
  const now = new Date();
  const ymd = offset => { const d = new Date(now); d.setDate(now.getDate() + offset); return fmtDate(d); };

  STATE.tasks = [
    {
      id: 'demo1', title: 'Kumpulkan laporan RO',
      description: 'Laporan riset operasi bab 3-5. Gunakan format IEEE.',
      category: 'Kuliah', priority: 'Tinggi', dueDate: ymd(1), dueTime: '10:00',
      recur: 'none', kanbanStatus: 'todo', done: false,
      createdAt: Date.now() - 3600000, completedAt: null,
      subtasks: [
        { id: 'ds1a', title: 'Buat outline', done: true },
        { id: 'ds1b', title: 'Tulis bab 3', done: true },
        { id: 'ds1c', title: 'Tulis bab 4', done: false },
        { id: 'ds1d', title: 'Tulis bab 5', done: false },
        { id: 'ds1e', title: 'Review & submit', done: false },
      ],
    },
    {
      id: 'demo2', title: 'Meeting sprint planning tim',
      description: 'Zoom call dengan tim produk — persiapkan backlog.',
      category: 'Kerja', priority: 'Sedang', dueDate: ymd(0), dueTime: '14:00',
      recur: 'weekly', kanbanStatus: 'inprogress', done: false,
      createdAt: Date.now() - 7200000, completedAt: null, subtasks: [],
    },
    {
      id: 'demo3', title: 'Beli groceries mingguan',
      description: 'Telur, sayur bayam, tempe, tahu, minyak goreng.',
      category: 'Belanja', priority: 'Rendah', dueDate: ymd(2), dueTime: '',
      recur: 'none', kanbanStatus: 'todo', done: false,
      createdAt: Date.now() - 86400000, completedAt: null, subtasks: [],
    },
    {
      id: 'demo4', title: 'Latihan LeetCode 2 soal', description: '',
      category: 'Pribadi', priority: 'Sedang', dueDate: ymd(0), dueTime: '20:00',
      recur: 'daily', kanbanStatus: 'todo', done: false,
      createdAt: Date.now() - 1800000, completedAt: null,
      subtasks: [
        { id: 'ds4a', title: 'Soal medium 1', done: false },
        { id: 'ds4b', title: 'Soal medium 2', done: false },
      ],
    },
    {
      id: 'demo5', title: 'Review PR teman di GitHub',
      description: 'PR #42 fitur login — periksa logic token refresh.',
      category: 'Kerja', priority: 'Tinggi', dueDate: ymd(-1), dueTime: '17:00',
      recur: 'none', kanbanStatus: 'todo', done: false,
      createdAt: Date.now() - 172800000, completedAt: null, subtasks: [],
    },
    {
      id: 'demo6', title: 'Olahraga pagi jogging',
      description: '30 menit di kompleks perumahan.',
      category: 'Pribadi', priority: 'Rendah', dueDate: ymd(0), dueTime: '06:00',
      recur: 'daily', kanbanStatus: 'done', done: true,
      createdAt: Date.now() - 90000000, completedAt: Date.now() - 3600000, subtasks: [],
    },
  ];
  saveStorage();
}

/* =========================================================
   TOASTS
========================================================= */
const _toastTimers = {};

function showToast(msg, type = 'info', action = null) {
  const container = document.getElementById('toast-container');
  const id        = generateId();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.id        = `toast-${id}`;
  toast.setAttribute('role', 'status');

  const msgSpan = document.createElement('span');
  msgSpan.className   = 'toast-msg';
  msgSpan.textContent = msg;
  toast.appendChild(msgSpan);

  if (action) {
    const btn = document.createElement('button');
    btn.className   = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.action(); removeToast(id); }, { once: true });
    toast.appendChild(btn);
  }

  const close = document.createElement('button');
  close.className   = 'toast-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Tutup notifikasi');
  close.addEventListener('click', () => removeToast(id));
  toast.appendChild(close);

  container.appendChild(toast);
  _toastTimers[id] = setTimeout(() => removeToast(id), action ? 8000 : 4000);
}

function removeToast(id) {
  clearTimeout(_toastTimers[id]);
  const el = document.getElementById(`toast-${id}`);
  if (!el) return;
  el.classList.add('removing');
  setTimeout(() => el.remove(), 250);
}

/* =========================================================
   REMINDER (deadline awareness – once per task per session)
========================================================= */
const _remindedIds = new Set();

function checkReminders() {
  const now     = Date.now();
  const oneHour = 60 * 60 * 1000;
  STATE.tasks.forEach(t => {
    if (t.done || !t.dueDate || _remindedIds.has(t.id)) return;
    const dueMs = new Date(t.dueDate + 'T' + (t.dueTime || '23:59') + ':00').getTime();
    if (dueMs > now && dueMs - now <= oneHour) {
      const mins = Math.round((dueMs - now) / 60000);
      _remindedIds.add(t.id);
      showToast(`⏰ "${t.title}" jatuh tempo dalam ${mins} menit!`, 'warning');
    }
  });
}

/* =========================================================
   THEME
========================================================= */
function applyTheme(theme) {
  STATE.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme');
  btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  btn.setAttribute('aria-label', theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap');
  saveTheme();
}

function toggleTheme() {
  applyTheme(STATE.theme === 'light' ? 'dark' : 'light');
}

/* =========================================================
   FOCUS TRAP  (accessibility – modal keyboard nav)
========================================================= */
let _focusTrapEl  = null;
let _prevFocusEl  = null;
const FOCUSABLE   = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapFocus(container) {
  _prevFocusEl = document.activeElement;
  _focusTrapEl = container;
}
function releaseFocus() {
  _focusTrapEl = null;
  if (_prevFocusEl && typeof _prevFocusEl.focus === 'function') _prevFocusEl.focus();
}

document.addEventListener('keydown', e => {
  if (!_focusTrapEl || e.key !== 'Tab') return;
  const els   = Array.from(_focusTrapEl.querySelectorAll(FOCUSABLE));
  if (!els.length) return;
  const first = els[0], last = els[els.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { last.focus(); e.preventDefault(); }
  } else {
    if (document.activeElement === last)  { first.focus(); e.preventDefault(); }
  }
});

/* =========================================================
   XSS PROTECTION
========================================================= */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip all HTML tags, return plain text. Never HTML-encodes. */
function sanitize(str) {
  const div = document.createElement('div');
  div.innerHTML = String(str);
  return div.textContent || '';
}

/* =========================================================
   HELPERS
========================================================= */
function catEmoji(cat) {
  return { Kuliah: '🎓', Kerja: '💼', Pribadi: '🙂', Belanja: '🛒', Lainnya: '📌' }[cat] || '📌';
}

/* =========================================================
   EVENTS
========================================================= */
function initEvents() {

  /* Sidebar toggle (mobile) */
  document.getElementById('btn-open-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('btn-close-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });

  /* Add task */
  document.getElementById('btn-add-task').addEventListener('click', () => openTaskModal(null));

  /* Mark all done */
  document.getElementById('btn-mark-all-done').addEventListener('click', markAllDone);

  /* Modal form */
  document.getElementById('task-form').addEventListener('submit', e => {
    e.preventDefault(); saveTaskFromModal();
  });
  document.getElementById('btn-modal-close').addEventListener('click', closeTaskModal);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeTaskModal);
  document.getElementById('modal-overlay').addEventListener('click', closeTaskModal);

  /* Description counter */
  document.getElementById('task-desc').addEventListener('input', updateDescCounter);

  /* Confirm modal */
  document.getElementById('btn-confirm-ok').addEventListener('click', executeDelete);
  document.getElementById('btn-confirm-cancel').addEventListener('click', closeConfirmModal);
  document.getElementById('confirm-overlay').addEventListener('click', closeConfirmModal);

  /* Subtask add in modal */
  const addSubtask = () => {
    const inp = document.getElementById('subtask-input');
    const val = inp.value.trim();
    if (!val) return;
    _modalSubtasks.push({ id: generateId(), title: val, done: false });
    inp.value = '';
    renderModalSubtasks();
    inp.focus();
  };
  document.getElementById('btn-add-subtask').addEventListener('click', addSubtask);
  document.getElementById('subtask-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
  });

  /* Search */
  document.getElementById('search-input').addEventListener('input', e => {
    STATE.filter.search = e.target.value;
    renderAll();
  });

  /* Filters */
  document.getElementById('filter-status').addEventListener('change', e => {
    STATE.filter.status = e.target.value; renderAll();
  });
  document.getElementById('filter-priority').addEventListener('change', e => {
    STATE.filter.priority = e.target.value; renderAll();
  });
  document.getElementById('sort-by').addEventListener('change', e => {
    STATE.filter.sort = e.target.value; renderAll();
  });

  /* Category filter (sidebar) */
  document.getElementById('cat-list').addEventListener('click', e => {
    const btn = e.target.closest('.cat-btn');
    if (!btn) return;
    document.querySelectorAll('.cat-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    STATE.filter.category = btn.dataset.cat;
    renderAll();
  });

  /* View toggle */
  document.getElementById('btn-list-view').addEventListener('click', () => {
    STATE.view = 'list';
    document.getElementById('view-list').classList.remove('hidden');
    document.getElementById('view-kanban').classList.add('hidden');
    document.getElementById('btn-list-view').classList.add('active');
    document.getElementById('btn-kanban-view').classList.remove('active');
    renderAll();
  });
  document.getElementById('btn-kanban-view').addEventListener('click', () => {
    STATE.view = 'kanban';
    document.getElementById('view-kanban').classList.remove('hidden');
    document.getElementById('view-list').classList.add('hidden');
    document.getElementById('btn-kanban-view').classList.add('active');
    document.getElementById('btn-list-view').classList.remove('active');
    renderAll();
  });

  /* Theme */
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  /* Quick-add */
  document.getElementById('btn-quick-add').addEventListener('click', handleQuickAdd);
  document.getElementById('quick-add-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleQuickAdd(); }
  });

  /* Export / Import */
  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('import-file').addEventListener('change', e => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });

  /* Clear done + reset */
  document.getElementById('btn-clear-done').addEventListener('click', clearDoneTasks);
  document.getElementById('btn-reset').addEventListener('click', resetAllData);

  /* Pomodoro */
  document.getElementById('btn-pomo-start').addEventListener('click', pomoStart);
  document.getElementById('btn-pomo-pause').addEventListener('click', pomoPause);
  document.getElementById('btn-pomo-reset').addEventListener('click', pomoReset);
  document.getElementById('btn-pomo-minimize').addEventListener('click', () => {
    document.getElementById('pomodoro-widget').style.display = 'none';
    document.getElementById('btn-open-pomo').style.display   = '';
  });
  document.getElementById('btn-open-pomo').addEventListener('click', () => {
    document.getElementById('pomodoro-widget').style.display = '';
    document.getElementById('btn-open-pomo').style.display   = 'none';
  });

  /* ---- Keyboard shortcuts ---- */
  document.addEventListener('keydown', e => {
    const tag     = document.activeElement.tagName;
    const inInput = ['INPUT','TEXTAREA','SELECT'].includes(tag) ||
                    document.activeElement.isContentEditable;

    // Escape: close whichever modal is open
    if (e.key === 'Escape') {
      e.preventDefault();
      closeTaskModal();
      closeConfirmModal();
      document.getElementById('quick-preview').classList.add('hidden');
      document.getElementById('quick-clarify').classList.add('hidden');
      return;
    }

    if (inInput) return;

    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTaskModal(null); }
    if (e.key === '/')                   { e.preventDefault(); document.getElementById('search-input').focus(); }

    // D = toggle done on focused card
    if (e.key === 'd' || e.key === 'D') {
      const focused = document.activeElement;
      const card    = focused.closest('.task-card');
      if (card && card.dataset.id) {
        e.preventDefault();
        const t = STATE.tasks.find(t => t.id === card.dataset.id);
        if (!t) return;
        if (t.done) updateTask(t.id, { done: false });
        else        completeTask(t.id);
        renderAll();
      }
    }
  });

  /* Close sidebar on outside click (mobile) */
  document.addEventListener('click', e => {
    const sidebar = document.getElementById('sidebar');
    const btnOpen = document.getElementById('btn-open-sidebar');
    if (sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        e.target !== btnOpen && !btnOpen.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
}

/* =========================================================
   INIT
========================================================= */
function init() {
  loadStorage();
  if (STATE.tasks.length === 0) loadDummyTasks();

  applyTheme(STATE.theme);
  initEvents();
  initKanbanDrop();
  renderAll();
  renderPomo();

  // Reminder: check every 60 s + once on load
  setInterval(checkReminders, 60_000);
  checkReminders();
}

document.addEventListener('DOMContentLoaded', init);
