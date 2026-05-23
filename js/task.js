document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const taskId = urlParams.get('id');
  const task = Storage.getTask(taskId);

  if (!task) {
    window.location.href = 'index.html';
    return;
  }

  // Header
  document.getElementById('taskPageTitle').textContent = task.name;
  document.getElementById('taskColorBar').style.background = task.color;

  // Delete
  document.getElementById('deleteTaskBtn').onclick = () => {
    const modal = document.getElementById('confirmModal');
    modal.style.display = 'flex';
    document.getElementById('confirmCancel').onclick = () => modal.style.display = 'none';
    document.getElementById('confirmDelete').onclick = () => {
      Storage.deleteTask(taskId);
      window.location.href = 'index.html';
    };
  };

  // Checklist
  const checklistEl = document.getElementById('checklist');
  const checkInput = document.getElementById('checkInput');
  const addCheckBtn = document.getElementById('addCheckBtn');
  const barFill = document.getElementById('checkBarFill');
  const progressText = document.getElementById('checkProgressText');

  function renderChecklist() {
    const currentTask = Storage.getTask(taskId);
    checklistEl.innerHTML = '';
    let doneCount = 0;

    currentTask.checklist.forEach((item, idx) => {
      if (item.done) doneCount++;
      const li = document.createElement('li');
      li.className = `check-item ${item.done ? 'done' : ''}`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.done;
      checkbox.onchange = () => {
        currentTask.checklist[idx].done = !currentTask.checklist[idx].done;
        Storage.updateTask(currentTask);
        renderChecklist();
      };

      const span = document.createElement('span');
      span.textContent = item.text;

      li.appendChild(checkbox);
      li.appendChild(span);
      checklistEl.appendChild(li);
    });

    const total = currentTask.checklist.length;
    const percent = total === 0 ? 0 : (doneCount / total) * 100;
    barFill.style.width = `${percent}%`;
    progressText.textContent = `${doneCount} / ${total}`;
  }

  addCheckBtn.onclick = () => {
    const text = checkInput.value.trim();
    if (text) {
      const currentTask = Storage.getTask(taskId);
      currentTask.checklist.push({ text, done: false });
      Storage.updateTask(currentTask);
      checkInput.value = '';
      renderChecklist();
    }
  };

  renderChecklist();
  Timer.init();
  Tree.init(taskId);
});
