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
  renderTasks();
  setupEventListeners();
  // Re-render every 60s to update urgency colors
  setInterval(renderTasks, 60000);
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

  // Sync banner toggle
  document.getElementById('btn-sync').addEventListener('click', () => {
    document.getElementById('sync-banner').classList.toggle('open');
  });
  document.getElementById('btn-close-sync').addEventListener('click', () => {
    document.getElementById('sync-banner').classList.remove('open');
  });

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

  // Escape to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Build bookmarklet href
  buildBookmarklet();
}

// ===== Bookmarklet =====
function buildBookmarklet() {
  // The bookmarklet scrapes Drexel Learn (Brightspace D2L) for assignments
  const code = `
(function(){
  var tasks=[];
  var courseName='';

  /* Try to get course name from breadcrumb or header */
  var breadcrumb=document.querySelector('.d2l-breadcrumbs, .d2l-navigation-s-header-title, [class*="course-name"]');
  if(breadcrumb) courseName=breadcrumb.textContent.trim().split('\\n')[0].trim();
  if(!courseName){
    var header=document.querySelector('h1, .d2l-page-title');
    if(header) courseName=header.textContent.trim();
  }

  /* Scrape assignment/activity rows */
  var rows=document.querySelectorAll(
    '.d2l-datalist-item, .d2l-le-Content tr, [class*="activity-item"], [class*="assignment"], .d2l-table tbody tr, .d2l-card, [role="listitem"]'
  );
  rows.forEach(function(row){
    var nameEl=row.querySelector('a, .d2l-link, [class*="title"], th, .d2l-heading');
    var name=nameEl?nameEl.textContent.trim():'';
    if(!name) return;

    var link='';
    var anchor=row.querySelector('a[href]');
    if(anchor) link=anchor.href;

    var dateText='';
    var dateEl=row.querySelector('[class*="date"], [class*="due"], time, .d2l-dates-text, td:nth-child(3), td:nth-child(2)');
    if(dateEl) dateText=dateEl.textContent.trim();

    var dueDate='';
    if(dateText){
      var parsed=new Date(dateText);
      if(!isNaN(parsed.getTime())) dueDate=parsed.toISOString().slice(0,16);
    }

    tasks.push({name:name,course:courseName,dueDate:dueDate,link:link,type:'assignment',hints:'',notes:''});
  });

  /* Also try calendar events */
  var events=document.querySelectorAll('.d2l-calendar-event, [class*="event-item"], .d2l-collapsepane');
  events.forEach(function(ev){
    var name=ev.textContent.trim().split('\\n')[0].trim();
    if(!name||name.length>200) return;
    var anchor=ev.querySelector('a[href]');
    var link=anchor?anchor.href:'';
    tasks.push({name:name,course:courseName,dueDate:'',link:link,type:'assignment',hints:'',notes:''});
  });

  if(tasks.length===0){
    alert('No tasks found on this page. Try navigating to your Assignments or Calendar page in Drexel Learn.');
    return;
  }

  var encoded=btoa(encodeURIComponent(JSON.stringify(tasks)));
  var dashUrl=localStorage.getItem('austins_dash_url')||'https://bytesizedata.github.io/AustinsMasterDash/';
  window.open(dashUrl+'#import='+encoded,'_blank');
})();
  `.trim();

  const minified = code.replace(/\s+/g, ' ').replace(/\s*([{}();,=+|&!<>])\s*/g, '$1');
  const href = 'javascript:' + encodeURIComponent(minified);

  const link = document.getElementById('bookmarklet-link');
  if (link) {
    link.href = href;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      alert('Drag this link to your bookmarks bar — don\'t click it here! Then click it when you\'re on Drexel Learn.');
    });
  }
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
