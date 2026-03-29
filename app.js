/* ===== Austin's Master Dash — App Logic ===== */

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
  renderTasks();
  setupEventListeners();
  // Re-render every 60s to update urgency colors
  setInterval(renderTasks, 60000);
  // Check for synced data every 5 minutes
  setInterval(checkForSyncedData, 300000);
});

// ===== Storage =====
function loadTasks() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    tasks = data ? JSON.parse(data) : [];
  } catch {
    tasks = [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// ===== Check for bookmarklet data in URL hash =====
function checkForImportedData() {
  const hash = window.location.hash;
  if (!hash.startsWith('#import=')) return;

  try {
    const encoded = hash.slice(8); // remove '#import='
    const json = decodeURIComponent(atob(encoded));
    const imported = JSON.parse(json);

    if (!Array.isArray(imported)) return;

    let added = 0;
    for (const item of imported) {
      // Skip if we already have a task with the same name and due date
      const exists = tasks.some(t =>
        t.name === item.name && t.dueDate === item.dueDate && !t.completed
      );
      if (!exists) {
        tasks.push({
          id: generateId(),
          name: item.name || 'Unnamed Task',
          course: item.course || '',
          dueDate: item.dueDate || '',
          type: item.type || 'assignment',
          link: item.link || '',
          hints: item.hints || '',
          notes: item.notes || '',
          completed: false,
          createdAt: new Date().toISOString()
        });
        added++;
      }
    }

    if (added > 0) {
      saveTasks();
      showToast(`Synced ${added} task${added > 1 ? 's' : ''} from Drexel Learn!`, 'success');
    } else {
      showToast('All tasks already up to date.', 'success');
    }

    // Clean URL
    history.replaceState(null, '', window.location.pathname);
  } catch (e) {
    console.error('Import error:', e);
  }
}

// ===== Check for synced data from sync.py =====
function checkForSyncedData() {
  fetch('tasks.json?t=' + Date.now())
    .then(r => { if (!r.ok) throw new Error('No tasks.json'); return r.json(); })
    .then(synced => {
      if (!Array.isArray(synced) || synced.length === 0) return;

      // Check if tasks.json is newer than what we have
      const lastSync = localStorage.getItem('austins_dash_last_sync') || '';
      const syncTime = synced[0]?.createdAt || '';

      // Merge: keep completed status from localStorage, update everything else from tasks.json
      const completedMap = {};
      for (const t of tasks) {
        if (t.completed) completedMap[t.name + '|' + t.course] = true;
      }

      // Also keep any manually added tasks (ones not from Drexel scrape)
      const manualTasks = tasks.filter(t => !t.id.startsWith('drexel_'));

      // Build new task list from synced data
      const newTasks = [];
      for (const item of synced) {
        const key = item.name + '|' + item.course;
        newTasks.push({
          id: item.id || generateId(),
          name: item.name || 'Unnamed',
          course: item.course || '',
          dueDate: item.dueDate || '',
          type: item.type || 'assignment',
          link: item.link || '',
          hints: item.hints || '',
          notes: item.notes || '',
          completed: completedMap[key] || false,
          createdAt: item.createdAt || new Date().toISOString()
        });
      }

      // Add back manual tasks
      for (const mt of manualTasks) {
        const exists = newTasks.some(t => t.name === mt.name && t.course === mt.course);
        if (!exists) newTasks.push(mt);
      }

      tasks = newTasks;
      localStorage.setItem('austins_dash_last_sync', syncTime);
      saveTasks();
      renderTasks();
      showToast(`Loaded ${synced.length} tasks from Drexel Learn!`, 'success');
    })
    .catch(() => {}); // No tasks.json yet, that's fine
}

// ===== Urgency =====
function getUrgency(dueDate) {
  if (!dueDate) return 'green';
  const now = Date.now();
  const due = new Date(dueDate).getTime();
  const diff = due - now;

  if (diff < 0) return 'red'; // overdue
  if (diff <= HOURS_72) return 'red';
  if (diff <= DAYS_7) return 'yellow';
  return 'green';
}

function formatDueDate(dueDate) {
  if (!dueDate) return 'No due date';
  const d = new Date(dueDate);
  const now = new Date();
  const diff = d - now;

  const options = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const formatted = d.toLocaleDateString('en-US', options);

  if (diff < 0) {
    const hoursAgo = Math.abs(Math.floor(diff / 3600000));
    if (hoursAgo < 24) return `OVERDUE (${hoursAgo}h ago) — ${formatted}`;
    const daysAgo = Math.floor(hoursAgo / 24);
    return `OVERDUE (${daysAgo}d ago) — ${formatted}`;
  }

  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h left — ${formatted}`;
  const days = Math.floor(hours / 24);
  return `${days}d left — ${formatted}`;
}

// ===== Render =====
function renderTasks() {
  const list = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');
  const stats = document.getElementById('stats');

  let filtered = [...tasks];

  // Sort: incomplete first, then by due date (soonest first), completed at bottom
  filtered.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return aDate - bDate;
  });

  // Apply filters
  if (currentFilter === 'active') filtered = filtered.filter(t => !t.completed);
  else if (currentFilter === 'completed') filtered = filtered.filter(t => t.completed);
  else if (currentFilter === 'urgent') filtered = filtered.filter(t => !t.completed && getUrgency(t.dueDate) === 'red');

  if (currentCourse !== 'all') filtered = filtered.filter(t => t.course === currentCourse);

  // Stats
  const active = tasks.filter(t => !t.completed).length;
  const urgent = tasks.filter(t => !t.completed && getUrgency(t.dueDate) === 'red').length;
  stats.textContent = `${active} active${urgent ? ` · ${urgent} urgent` : ''} · ${tasks.length} total`;

  // Update course filter dropdown
  updateCourseFilter();

  if (tasks.length === 0) {
    list.innerHTML = '';
    empty.classList.add('visible');
    return;
  }

  empty.classList.remove('visible');

  list.innerHTML = filtered.map(task => {
    const urgency = task.completed ? '' : getUrgency(task.dueDate);
    const urgencyClass = task.completed ? 'completed' : `urgency-${urgency}`;
    const dueLabel = formatDueDate(task.dueDate);
    const dueLabelClass = urgency === 'red' ? 'urgent' : urgency === 'yellow' ? 'warning' : '';

    return `
      <div class="task-card ${urgencyClass}" data-id="${task.id}">
        <div class="task-urgency-bar"></div>
        <div class="task-check">
          <input type="checkbox" ${task.completed ? 'checked' : ''} onchange="toggleTask('${task.id}')" title="Mark ${task.completed ? 'incomplete' : 'complete'}">
        </div>
        <div class="task-body">
          <div class="task-top">
            <span class="task-name">${escapeHtml(task.name)}</span>
            ${task.type ? `<span class="task-badge">${escapeHtml(task.type)}</span>` : ''}
            ${task.course ? `<span class="task-course-badge">${escapeHtml(task.course)}</span>` : ''}
          </div>
          <div class="task-meta">
            <span class="task-due-label ${dueLabelClass}">${dueLabel}</span>
          </div>
          ${task.hints ? `<div class="task-hints-row">Tip: ${escapeHtml(task.hints)}</div>` : ''}
        </div>
        <div class="task-actions">
          ${task.link ? `<a href="${escapeHtml(task.link)}" target="_blank" class="task-link-btn" title="Open in Drexel Learn">Open</a>` : ''}
          <button class="btn btn-ghost" onclick="editTask('${task.id}')" title="Edit">Edit</button>
          <button class="btn btn-danger" onclick="deleteTask('${task.id}')" title="Delete">Del</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateCourseFilter() {
  const select = document.getElementById('course-filter');
  const courses = [...new Set(tasks.map(t => t.course).filter(Boolean))].sort();
  const current = select.value;

  select.innerHTML = '<option value="all">All Courses</option>' +
    courses.map(c => `<option value="${c}" ${c === current ? 'selected' : ''}>${c}</option>`).join('');
}

// ===== Task CRUD =====
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

window.toggleTask = function(id) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveTasks();
    renderTasks();
  }
};

window.deleteTask = function(id) {
  if (!confirm('Delete this task?')) return;
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  renderTasks();
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
};

function openAddModal() {
  document.getElementById('modal-title').textContent = 'Add Task';
  document.getElementById('task-form').reset();
  document.getElementById('task-id').value = '';
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('task-name').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

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
    // Edit existing
    const task = tasks.find(t => t.id === id);
    if (task) Object.assign(task, data);
    showToast('Task updated!', 'success');
  } else {
    // Add new
    tasks.push({
      id: generateId(),
      ...data,
      completed: false,
      createdAt: new Date().toISOString()
    });
    showToast('Task added!', 'success');
  }

  saveTasks();
  renderTasks();
  closeModal();
}

// ===== Export / Import =====
function exportData() {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `austins-master-dash-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup exported!', 'success');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      tasks = imported;
      saveTasks();
      renderTasks();
      showToast(`Imported ${imported.length} tasks!`, 'success');
    } catch {
      showToast('Invalid backup file.', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ===== Event Listeners =====
function setupEventListeners() {
  document.getElementById('btn-add-task').addEventListener('click', openAddModal);
  document.getElementById('btn-add-first')?.addEventListener('click', openAddModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('task-form').addEventListener('submit', saveTask);
  document.getElementById('btn-backup').addEventListener('click', exportData);
  document.getElementById('file-import').addEventListener('change', importData);

  // Quick Import modal
  document.getElementById('btn-quick-import').addEventListener('click', () => {
    document.getElementById('import-modal-overlay').classList.add('open');
  });
  document.getElementById('btn-import-cancel').addEventListener('click', () => {
    document.getElementById('import-modal-overlay').classList.remove('open');
  });
  document.getElementById('import-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('import-modal-overlay').classList.remove('open');
  });
  document.getElementById('btn-import-parse').addEventListener('click', parseQuickImport);

  // Filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTasks();
    });
  });

  document.getElementById('course-filter').addEventListener('change', (e) => {
    currentCourse = e.target.value;
    renderTasks();
  });

  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Escape to close any modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.getElementById('import-modal-overlay').classList.remove('open');
    }
  });

}

// ===== Quick Import Parser =====
window.parseQuickImport = function() {
  const text = document.getElementById('import-paste').value.trim();
  const course = document.getElementById('import-course').value.trim();

  if (!text) {
    showToast('Please paste some content from Drexel Learn.', 'error');
    return;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const found = [];

  // Date patterns commonly found in Brightspace/D2L
  const datePatterns = [
    /(\w+ \d{1,2},?\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))?)/,  // Apr 5, 2026 11:59 PM
    /(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))?)/,  // 4/5/2026 11:59 PM
    /(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?)/,  // 2026-04-05T23:59
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:,?\s*\d{4})?(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))?)/i,  // March 30 at 11:59 PM
  ];

  // Task type keywords
  const typeMap = {
    quiz: /quiz|exam|test|midterm|final/i,
    discussion: /discuss|forum|post|board/i,
    project: /project|presentation|group/i,
    assignment: /assign|homework|hw|lab|report|paper|essay|submission/i,
  };

  // Skip lines that are just navigation/UI text
  const skipPatterns = /^(home|content|activities|grades|calendar|progress|classlist|course\s+home|notifications|sign|log\s*(in|out)|menu|search|help|skip|navigation|footer|header|©|\d+%|no\s+items|showing|sort|filter|page\s+\d)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip short lines, UI/nav text
    if (line.length < 3 || skipPatterns.test(line)) continue;

    // Look for a date in this line or nearby lines
    let dateStr = '';
    let parsedDate = '';

    // Check current line and next 2 lines for dates
    for (let j = i; j < Math.min(i + 3, lines.length); j++) {
      for (const pattern of datePatterns) {
        const match = lines[j].match(pattern);
        if (match) {
          dateStr = match[1];
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            parsedDate = d.toISOString().slice(0, 16);
          }
          break;
        }
      }
      if (parsedDate) break;
    }

    // If this line has a date in it, it might be a due date line, not a task name
    // Check if the line is mostly a date
    let isDateLine = false;
    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match && match[0].length > line.length * 0.5) {
        isDateLine = true;
        break;
      }
    }
    if (isDateLine) continue;

    // Check if line looks like a task name (has enough substance)
    if (line.length < 5 || line.length > 200) continue;

    // Detect task type
    let type = 'assignment';
    for (const [t, re] of Object.entries(typeMap)) {
      if (re.test(line)) { type = t; break; }
    }

    // Avoid duplicates
    const alreadyFound = found.some(f => f.name === line);
    const alreadyExists = tasks.some(t => t.name === line && !t.completed);
    if (alreadyFound || alreadyExists) continue;

    // If it looks like a real task (has a date or looks like an assignment name)
    if (parsedDate || typeMap.assignment.test(line) || typeMap.quiz.test(line) || typeMap.discussion.test(line) || typeMap.project.test(line)) {
      found.push({
        name: line,
        dueDate: parsedDate,
        type: type,
      });
    }
  }

  if (found.length === 0) {
    showToast('No tasks found. Try copying more content from the page, or add tasks manually.', 'error');
    return;
  }

  // Add found tasks
  for (const item of found) {
    tasks.push({
      id: generateId(),
      name: item.name,
      course: course,
      dueDate: item.dueDate,
      type: item.type,
      link: '',
      hints: '',
      notes: '',
      completed: false,
      createdAt: new Date().toISOString()
    });
  }

  saveTasks();
  renderTasks();
  document.getElementById('import-modal-overlay').classList.remove('open');
  document.getElementById('import-paste').value = '';
  showToast(`Imported ${found.length} task${found.length > 1 ? 's' : ''} from Drexel Learn!`, 'success');
}

// ===== Toast Notifications =====
function showToast(message, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// ===== Utils =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
