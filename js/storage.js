const Storage = {
  getTasks() {
    return JSON.parse(localStorage.getItem('nf_tasks') || '[]');
  },
  saveTasks(tasks) {
    localStorage.setItem('nf_tasks', JSON.stringify(tasks));
  },
  getTask(id) {
    return this.getTasks().find(t => t.id === id);
  },
  addTask(task) {
    const tasks = this.getTasks();
    tasks.push(task);
    this.saveTasks(tasks);
  },
  updateTask(task) {
    const tasks = this.getTasks();
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      tasks[idx] = task;
      this.saveTasks(tasks);
    }
  },
  deleteTask(id) {
    const tasks = this.getTasks().filter(t => t.id !== id);
    this.saveTasks(tasks);
  }
};
