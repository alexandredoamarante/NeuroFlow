const taskNameInput = document.getElementById('taskNameInput');
const taskDescInput = document.getElementById('taskDescInput');
const colorPicker = document.getElementById('colorPicker');
const createTaskBtn = document.getElementById('createTaskBtn');
const tasksGrid = document.getElementById('tasksGrid');
const taskCount = document.getElementById('taskCount');
const emptyState = document.getElementById('emptyState');

let selectedColor = '#60a5fa';

// Color picker
colorPicker?.addEventListener('click', (e) => {
  if (e.target.classList.contains('color-dot')) {
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    e.target.classList.add('active');
    selectedColor = e.target.dataset.color;
  }
});

async function renderTasks() {
  taskCount.textContent = "Carregando...";
  const tasks = await Storage.getTasks();
  taskCount.textContent = `${tasks.length} tarefa${tasks.length !== 1 ? 's' : ''}`;

  if (tasks.length === 0) {
    emptyState.style.display = 'block';
    // Clear existing cards
    const cards = tasksGrid.querySelectorAll('.task-card');
    cards.forEach(c => c.remove());
    return;
  }

  emptyState.style.display = 'none';
  tasksGrid.innerHTML = '';

  tasks.forEach(task => {
    const card = document.createElement('div');
    card.className = 'glass task-card';

    const header = document.createElement('div');
    header.className = 'task-card-header';
    const colorDot = document.createElement('div');
    colorDot.className = 'task-card-color';
    colorDot.style.color = task.color;
    colorDot.style.backgroundColor = task.color;
    header.appendChild(colorDot);

    const title = document.createElement('div');
    title.className = 'task-card-title';
    title.textContent = task.name;

    const desc = document.createElement('div');
    desc.className = 'task-card-desc';
    if (typeof renderSafeLinks === 'function') {
      renderSafeLinks(task.desc || 'Sem descrição', desc, true);
    } else {
      desc.textContent = task.desc || 'Sem descrição';
    }

    const footer = document.createElement('div');
    footer.className = 'task-card-footer';
    const itemInfo = document.createElement('span');
    itemInfo.textContent = `${task.checklist?.length || 0} itens`;
    const sessionInfo = document.createElement('span');
    sessionInfo.textContent = `${task.sessions || 0} sessões`;
    footer.appendChild(itemInfo);
    footer.appendChild(sessionInfo);

    card.appendChild(header);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(footer);

    card.onclick = () => window.location.href = `task.html?id=${task.id}`;
    tasksGrid.appendChild(card);
  });
}

createTaskBtn?.addEventListener('click', async () => {
  const name = taskNameInput.value.trim();
  if (!name) return;

  createTaskBtn.disabled = true;
  const newTask = {
    id: Date.now().toString(),
    name,
    desc: taskDescInput.value.trim(),
    color: selectedColor,
    sessions: 0,
    checklist: [],
    nodes: []
  };

  await Storage.saveTask(newTask);
  taskNameInput.value = '';
  taskDescInput.value = '';
  createTaskBtn.disabled = false;
  renderTasks();
});

renderTasks();

// Listen for background updates from Supabase
window.addEventListener('tasksUpdated', () => renderTasks());
