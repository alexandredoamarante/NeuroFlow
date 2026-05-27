const taskPageTitle = document.getElementById('taskPageTitle');
const taskColorBar = document.getElementById('taskColorBar');
const deleteTaskBtn = document.getElementById('deleteTaskBtn');
const confirmModal = document.getElementById('confirmModal');
const confirmDelete = document.getElementById('confirmDelete');
const confirmCancel = document.getElementById('confirmCancel');

const checkInput = document.getElementById('checkInput');
const addCheckBtn = document.getElementById('addCheckBtn');
const checklistUl = document.getElementById('checklist');
const checkBarFill = document.getElementById('checkBarFill');
const checkProgressText = document.getElementById('checkProgressText');

const addRootNodeBtn = document.getElementById('addRootNodeBtn');

let currentTask = null;

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');

  // Storage.getTask now waits for cloud data if cache is empty/logged-in
  currentTask = await Storage.getTask(id);

  if (!currentTask) {
    window.location.href = 'index.html';
    return;
  }

  finishInit();
}

function finishInit() {

  taskPageTitle.textContent = currentTask.name;
  taskColorBar.style.backgroundColor = currentTask.color;

  // Init Timer
  if (typeof initTimer === 'function') initTimer(currentTask);

  // Init Checklist
  renderChecklist();

  // Init Tree
  if (typeof renderTree === 'function') {
    window.currentNodes = currentTask.nodes || [];
    renderTree(window.currentNodes, document.getElementById('treeContainer'), currentTask.id);
  }

  // Init Highlights
  if (typeof Highlights !== 'undefined') {
    Highlights.init();
  }
}

// Checklist
function renderChecklist() {
  checklistUl.innerHTML = '';
  const list = currentTask.checklist || [];

  let doneCount = 0;
  list.forEach((item, index) => {
    if (item.done) doneCount++;
    const li = document.createElement('li');
    li.className = `check-item ${item.done ? 'done' : ''}`;

    const cb = document.createElement('div');
    cb.className = `check-cb ${item.done ? 'active' : ''}`;
    cb.innerHTML = item.done ? '<svg viewBox="0 0 20 20" fill="none" style="width:12px;height:12px;"><path d="M4 10l4 4 8-8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
    cb.onclick = () => toggleCheck(index);

    const textSpan = document.createElement('span');
    textSpan.className = 'check-text';
    if (typeof renderSafeLinks === 'function') {
      renderSafeLinks(item.text, textSpan);
    } else {
      textSpan.textContent = item.text;
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'lg-btn ghost sm';
    delBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" style="width:14px;height:14px;"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteCheck(index);
    };

    li.appendChild(cb);
    li.appendChild(textSpan);
    li.appendChild(delBtn);

    checklistUl.appendChild(li);
  });

  const percent = list.length ? (doneCount / list.length) * 100 : 0;
  checkBarFill.style.width = `${percent}%`;
  checkProgressText.textContent = `${doneCount} / ${list.length}`;
}

async function syncAndSaveTask() {
  const latest = await Storage.getTask(currentTask.id);
  // Merge currentTask checklist/sessions into latest
  latest.checklist = currentTask.checklist;
  latest.sessions = currentTask.sessions;
  // If we had more fields, we'd sync them too.
  // Nodes are handled by tree.js which also pulls from Storage.
  await Storage.saveTask(latest);
}

async function toggleCheck(index) {
  currentTask.checklist[index].done = !currentTask.checklist[index].done;
  await syncAndSaveTask();
  renderChecklist();
}

async function deleteCheck(index) {
  currentTask.checklist.splice(index, 1);
  await syncAndSaveTask();
  renderChecklist();
}

addCheckBtn?.addEventListener('click', async () => {
  const text = checkInput.value.trim();
  if (!text) return;
  addCheckBtn.disabled = true;
  try {
    if (!currentTask.checklist) currentTask.checklist = [];
    currentTask.checklist.push({ text, done: false });
    await syncAndSaveTask();
    checkInput.value = '';
    renderChecklist();
  } finally {
    addCheckBtn.disabled = false;
  }
});

// Delete Task
deleteTaskBtn?.addEventListener('click', () => confirmModal.style.display = 'flex');
confirmCancel?.addEventListener('click', () => confirmModal.style.display = 'none');
confirmDelete?.addEventListener('click', async () => {
  await Storage.deleteTask(currentTask.id);
  window.location.href = 'index.html';
});

addRootNodeBtn?.addEventListener('click', () => {
  if (typeof addNode === 'function') addNode();
});

window.deleteCheck = deleteCheck;

init();

// Listen for background updates from Supabase
window.addEventListener('tasksUpdated', async (e) => {
  // Prevent refresh if user is currently selecting text, interacting with a highlight popover, or syncing
  if (window.getSelection().toString().trim() || window.isInteractingWithHighlight || Storage._isSyncing) {
    return;
  }

  const updatedTasks = e.detail;
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');
  const updatedTask = updatedTasks.find(t => t.id === id);
  if (updatedTask) {
    currentTask = updatedTask;
    taskPageTitle.textContent = currentTask.name;
    taskColorBar.style.backgroundColor = currentTask.color;
    renderChecklist();
    if (typeof renderTree === 'function') {
      window.currentNodes = currentTask.nodes || [];
      renderTree(window.currentNodes, document.getElementById('treeContainer'), currentTask.id);
    }
  }
});
