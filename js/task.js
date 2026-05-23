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

function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');
  currentTask = Storage.getTask(id);

  if (!currentTask) {
    window.location.href = 'index.html';
    return;
  }

  taskPageTitle.textContent = currentTask.name;
  taskColorBar.style.backgroundColor = currentTask.color;

  // Init Timer
  if (typeof initTimer === 'function') initTimer(currentTask);

  // Init Checklist
  renderChecklist();

  // Init Tree
  if (typeof renderTree === 'function') {
    currentNodes = currentTask.nodes || [];
    renderTree(currentNodes, document.getElementById('treeContainer'), currentTask.id);
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
    cb.textContent = item.done ? '✓' : '';
    cb.onclick = () => toggleCheck(index);

    const textSpan = document.createElement('span');
    textSpan.className = 'check-text';
    textSpan.textContent = item.text;

    const delBtn = document.createElement('button');
    delBtn.className = 'lg-btn ghost sm';
    delBtn.textContent = '×';
    delBtn.onclick = () => deleteCheck(index);

    li.appendChild(cb);
    li.appendChild(textSpan);
    li.appendChild(delBtn);

    checklistUl.appendChild(li);
  });

  const percent = list.length ? (doneCount / list.length) * 100 : 0;
  checkBarFill.style.width = `${percent}%`;
  checkProgressText.textContent = `${doneCount} / ${list.length}`;
}

function toggleCheck(index) {
  currentTask.checklist[index].done = !currentTask.checklist[index].done;
  Storage.saveTask(currentTask);
  renderChecklist();
}

function deleteCheck(index) {
  currentTask.checklist.splice(index, 1);
  Storage.saveTask(currentTask);
  renderChecklist();
}

addCheckBtn?.addEventListener('click', () => {
  const text = checkInput.value.trim();
  if (!text) return;
  if (!currentTask.checklist) currentTask.checklist = [];
  currentTask.checklist.push({ text, done: false });
  Storage.saveTask(currentTask);
  checkInput.value = '';
  renderChecklist();
});

// Delete Task
deleteTaskBtn?.addEventListener('click', () => confirmModal.style.display = 'flex');
confirmCancel?.addEventListener('click', () => confirmModal.style.display = 'none');
confirmDelete?.addEventListener('click', () => {
  Storage.deleteTask(currentTask.id);
  window.location.href = 'index.html';
});

addRootNodeBtn?.addEventListener('click', () => {
  if (typeof addNode === 'function') addNode();
});

window.deleteCheck = deleteCheck;

init();
