document.addEventListener('DOMContentLoaded', () => {
  const taskNameInput = document.getElementById('taskNameInput');
  const taskDescInput = document.getElementById('taskDescInput');
  const createTaskBtn = document.getElementById('createTaskBtn');
  const colorPicker = document.getElementById('colorPicker');
  const tasksGrid = document.getElementById('tasksGrid');
  const emptyState = document.getElementById('emptyState');
  const taskCount = document.getElementById('taskCount');

  let selectedColor = '#60a5fa';

  if (colorPicker) {
    colorPicker.addEventListener('click', (e) => {
      if (e.target.classList.contains('color-dot')) {
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        e.target.classList.add('active');
        selectedColor = e.target.dataset.color;
      }
    });
  }

  function renderTasks() {
    const tasks = Storage.getTasks();
    taskCount.textContent = `${tasks.length} tarefa${tasks.length !== 1 ? 's' : ''}`;

    if (tasks.length === 0) {
      emptyState.style.display = 'block';
      tasksGrid.innerHTML = '';
      tasksGrid.appendChild(emptyState);
    } else {
      emptyState.style.display = 'none';
      tasksGrid.innerHTML = '';
      tasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'glass task-card';

        const header = document.createElement('div');
        header.className = 'task-card-header';
        const colorDot = document.createElement('div');
        colorDot.className = 'task-card-color';
        colorDot.style.background = task.color;
        header.appendChild(colorDot);

        const title = document.createElement('h3');
        title.className = 'task-card-title';
        title.textContent = task.name;

        const desc = document.createElement('p');
        desc.className = 'task-card-desc';
        desc.textContent = task.description || 'Sem descrição';

        card.appendChild(header);
        card.appendChild(title);
        card.appendChild(desc);

        card.onclick = () => window.location.href = `task.html?id=${task.id}`;
        tasksGrid.appendChild(card);
      });
    }
  }

  if (createTaskBtn) {
    createTaskBtn.addEventListener('click', () => {
      const name = taskNameInput.value.trim();
      if (!name) return;

      const newTask = {
        id: Date.now().toString(),
        name,
        description: taskDescInput.value.trim(),
        color: selectedColor,
        checklist: [],
        nodes: [],
        createdAt: new Date().toISOString()
      };

      Storage.addTask(newTask);
      taskNameInput.value = '';
      taskDescInput.value = '';
      renderTasks();
    });
  }

  renderTasks();
});
