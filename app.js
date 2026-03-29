/* ===== Austin's Master Dash — App Logic (3D Edition) ===== */

const STORAGE_KEY = 'austins_master_dash_tasks';
const HOURS_72 = 72 * 60 * 60 * 1000;
const DAYS_7 = 7 * 24 * 60 * 60 * 1000;

let tasks = [];
let currentFilter = 'all';
let currentCourse = 'all';

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  loadTasks();
  checkForImportedData();
  checkForSyncedData();
  updateStats();
  setupEventListeners();
  setInterval(updateStats, 60000);
});

// ===== Storage =====
function loadTasks() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    tasks = data ? JSON.parse(data) : [];
  } catch { tasks = []; }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// ===== Provide tasks to Three.js scene =====
window.getTasksForScene = function() {
  let filtered = [...tasks];

  if (currentFilter === 'active') filtered = filtered.filter(t => !t.completed);
  else if (currentFilter === 'completed') filtered = filtered.filter(t => t.completed);
  else if (currentFilter === 'urgent') filtered = filtered.filter(t => !t.completed && getUrgency(t.dueDate) === 'red');

  if (currentCourse !== 'all') filtered = filtered.filter(t => t.course === currentCourse);

  return filtered.map(t => ({
    ...t,
    urgency: t.completed ? 'green' : getUrgency(t.dueDate),
    dueLabel: formatDueDate(t.dueDate),
  }));
};

// ===== Side Panel =====
window.onTaskSelected = function(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const urgency = task.completed ? 'completed' : getUrgency(task.dueDate);
  const dueLabel = formatDueDate(task.dueDate);
  const dueClass = urgency === 'red' ? 'urgent' : urgency === 'yellow' ? 'warning' : 'safe';

  const panel = document.getElementById('panel-content');
  panel.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">${escapeHtml(task.name)}</div>
      <div class="panel-badges">
        ${task.type ? `<span class="panel-badge type">${escapeHtml(task.type)}</span>` : ''}
        ${task.course ? `<span class="panel-badge course">${escapeHtml(task.course)}</span>` : ''}
        ${task.completed ? '<span class="panel-badge type" style="background:rgba(255,255,255,0.06);color:#7a7e94">Completed</span>' : ''}
      </div>
    </div>

    <div class="panel-due ${dueClass}">${dueLabel}</div>

    ${task.hints ? `
    <div class="panel-section">
      <div class="panel-section-title">How to Find</div>
      <div class="panel-section-body">${escapeHtml(task.hints)}</div>
    </div>` : ''}

    ${task.notes ? `
    <div class="panel-section">
      <div class="panel-section-title">Notes</div>
      <div class="panel-section-body">${escapeHtml(task.notes)}</div>
    </div>` : ''}

    <div class="panel-actions">
      <button class="btn ${task.completed ? 'btn-primary' : 'btn-ghost'}" onclick="toggleTask('${task.id}')" style="border:1px solid var(--border)">
        ${task.completed ? 'Mark Incomplete' : 'Mark Complete'}
      </button>
      ${task.link ? `<a href="${escapeHtml(task.link)}" target="_blank" class="btn btn-primary" style="text-decoration:none">Open in Drexel Learn</a>` : ''}
    </div>
    <div class="panel-actions">
      <button class="btn btn-ghost" onclick="editTask('${task.id}')" style="border:1px solid var(--border)">Edit</button>
      <button class="btn btn-danger" onclick="deleteTask('${task.id}')" style="border:1px solid rgba(255,71,87,0.3)">Delete</button>
    </div>
  `;

  document.getElementById('side-panel').classList.add('open');
};

window.closePanel = function() {
  document.getElementById('side-panel').classList.remove('open');
};

// ===== Urgency =====
function getUrgency(dueDate) {
  if (!dueDate) return 'green';
  const diff = new Date(dueDate).getTime() - Date.now();
  if (diff < 0) return 'red';
  if (diff <= HOURS_72) return 'red';
  if (diff <= DAYS_7) return 'yellow';
  return 'green';
}

function formatDueDate(dueDate) {
  if (!dueDate) return 'No due date';
  const d = new Date(dueDate);
  const diff = d - Date.now();
  const options = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const formatted = d.toLocaleDateString('en-US', options);

  if (diff < 0) {
    const h = Math.abs(Math.floor(diff / 3600000));
    return h < 24 ? `OVERDUE (${h}h ago) — ${formatted}` : `OVERDUE (${Math.floor(h/24)}d ago) — ${formatted}`;
  }
  const h = Math.floor(diff / 3600000);
  return h < 24 ? `${h}h left — ${formatted}` : `${Math.floor(h/24)}d left — ${formatted}`;
}

// ===== Stats =====
function updateStats() {
  const stats = document.getElementById('stats');
  const active = tasks.filter(t => !t.completed).length;
  const urgent = tasks.filter(t => !t.completed && getUrgency(t.dueDate) === 'red').length;
  stats.textContent = `${active} active${urgent ? ` · ${urgent} urgent` : ''} · ${tasks.length} total`;
  updateCourseFilter();
}

function updateCourseFilter() {
  const select = document.getElementById('course-filter');
  const courses = [...new Set(tasks.map(t => t.course).filter(Boolean))].sort();
  const current = select.value;
  select.innerHTML = '<option value="all">All Courses</option>' +
    courses.map(c => `<option value="${c}" ${c === current ? 'selected' : ''}>${c}</option>`).join('');
}

// ===== Task CRUD =====
function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

window.toggleTask = function(id) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveTasks();
    updateStats();
    if (typeof window.rebuildScene === 'function') window.rebuildScene();
    window.onTaskSelected(id);
  }
};

window.deleteTask = function(id) {
  if (!confirm('Delete this task?')) return;
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  updateStats();
  closePanel();
  if (typeof window.rebuildScene === 'function') window.rebuildScene();
  showToast('Task deleted.', 'error');
};

window.editTask = function(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  document.getElementById('modal-title').textContent = 'Edit Task';
  document.getElementById('task-id').value = task.id;
  document.getElementById('task-name').value = task.name;
  document.getElementById('task-course').value = task.course;
  document.getElementById('task-due').value = task.dueDate ? task.dueDate.slice(0, 16) : '';
  document.getElementById('task-type').value = task.type || 'assignment';
  document.getElementById('task-link').value = task.link;
  document.getElementById('task-hints').value = task.hints;
  document.getElementById('task-notes').value = task.notes;
  document.getElementById('modal-overlay').classList.add('open');
  closePanel();
};

window.openAddModal = function() {
  document.getElementById('modal-title').textContent = 'Add Task';
  document.getElementById('task-form').reset();
  document.getElementById('task-id').value = '';
  document.getElementById('modal-overlay').classList.add('open');
};

window.closeModal = function() {
  document.getElementById('modal-overlay').classList.remove('open');
};

function saveTask(e) {
  e.preventDefault();
  const id = document.getElementById('task-id').value;
  const data = {
    name: document.getElementById('task-name').value.trim(),
    course: document.getElementById('task-course').value.trim(),
    dueDate: document.getElementById('task-due').value,
    type: document.getElementById('task-type').value,
    link: document.getElementById('task-link').value.trim(),
    hints: document.getElementById('task-hints').value.trim(),
    notes: document.getElementById('task-notes').value.trim(),
  };

  if (id) {
    const task = tasks.find(t => t.id === id);
    if (task) Object.assign(task, data);
    showToast('Task updated!', 'success');
  } else {
    tasks.push({ id: generateId(), ...data, completed: false, createdAt: new Date().toISOString() });
    showToast('Task added!', 'success');
  }

  saveTasks();
  updateStats();
  closeModal();
  if (typeof window.rebuildScene === 'function') window.rebuildScene();
}

// ===== Export / Import =====
window.exportData = function() {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `austins-dash-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  showToast('Backup exported!', 'success');
};

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error();
      tasks = imported;
      saveTasks();
      updateStats();
      if (typeof window.rebuildScene === 'function') window.rebuildScene();
      showToast(`Imported ${imported.length} tasks!`, 'success');
    } catch { showToast('Invalid file.', 'error'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ===== Synced Data =====
function checkForImportedData() {
  const hash = window.location.hash;
  if (!hash.startsWith('#import=')) return;
  try {
    const json = decodeURIComponent(atob(hash.slice(8)));
    const imported = JSON.parse(json);
    if (!Array.isArray(imported)) return;
    let added = 0;
    for (const item of imported) {
      if (!tasks.some(t => t.name === item.name && t.dueDate === item.dueDate && !t.completed)) {
        tasks.push({ id: generateId(), name: item.name||'', course: item.course||'', dueDate: item.dueDate||'', type: item.type||'assignment', link: item.link||'', hints: item.hints||'', notes: '', completed: false, createdAt: new Date().toISOString() });
        added++;
      }
    }
    if (added > 0) { saveTasks(); showToast(`Synced ${added} tasks!`, 'success'); }
    history.replaceState(null, '', window.location.pathname);
  } catch {}
}

function checkForSyncedData() {
  fetch('tasks.json?t=' + Date.now())
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(synced => {
      if (!Array.isArray(synced) || synced.length === 0) return;
      const completedMap = {};
      for (const t of tasks) { if (t.completed) completedMap[t.name + '|' + t.course] = true; }
      const manualTasks = tasks.filter(t => !t.id.startsWith('drexel_'));
      const newTasks = synced.map(item => ({
        id: item.id || generateId(),
        name: item.name || '', course: item.course || '', dueDate: item.dueDate || '',
        type: item.type || 'assignment', link: item.link || '', hints: item.hints || '',
        notes: item.notes || '', completed: completedMap[item.name + '|' + item.course] || false,
        createdAt: item.createdAt || new Date().toISOString(),
      }));
      for (const mt of manualTasks) {
        if (!newTasks.some(t => t.name === mt.name && t.course === mt.course)) newTasks.push(mt);
      }
      tasks = newTasks;
      saveTasks();
      updateStats();
      if (typeof window.rebuildScene === 'function') window.rebuildScene();
      showToast(`Loaded ${synced.length} tasks from Drexel Learn!`, 'success');
    })
    .catch(() => {});
}

// ===== Event Listeners =====
function setupEventListeners() {
  document.getElementById('task-form').addEventListener('submit', saveTask);
  document.getElementById('file-import').addEventListener('change', importData);

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      updateStats();
      if (typeof window.rebuildScene === 'function') window.rebuildScene();
    });
  });

  document.getElementById('course-filter').addEventListener('change', (e) => {
    currentCourse = e.target.value;
    if (typeof window.rebuildScene === 'function') window.rebuildScene();
  });

  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('scrape-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.target.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closePanel();
      document.getElementById('scrape-modal-overlay').classList.remove('open');
    }
  });
}

// ===== Toast =====
function showToast(message, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
