const Storage = {
  getTasks() {
    return JSON.parse(localStorage.getItem('neuroflow_tasks') || '[]');
  },
  saveTasks(tasks) {
    localStorage.setItem('neuroflow_tasks', JSON.stringify(tasks));
  },
  getTask(id) {
    return this.getTasks().find(t => t.id === id);
  },
  saveTask(task) {
    const tasks = this.getTasks();
    const index = tasks.findIndex(t => t.id === task.id);
    if (index > -1) {
      tasks[index] = task;
    } else {
      tasks.push(task);
    }
    this.saveTasks(tasks);
  },
  deleteTask(id) {
    const tasks = this.getTasks().filter(t => t.id !== id);
    this.saveTasks(tasks);
  }
};
