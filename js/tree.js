const Tree = {
  container: document.getElementById('treeContainer'),
  emptyState: document.getElementById('treeEmpty'),
  taskId: null,

  init(taskId) {
    this.taskId = taskId;
    this.render();

    document.getElementById('addRootNodeBtn').onclick = () => this.openModal();
  },

  render() {
    const task = Storage.getTask(this.taskId);
    if (!task || !task.nodes || task.nodes.length === 0) {
      this.emptyState.style.display = 'block';
      this.container.innerHTML = '';
      this.container.appendChild(this.emptyState);
    } else {
      this.emptyState.style.display = 'none';
      this.container.innerHTML = '';
      task.nodes.forEach(node => this.renderNode(node, this.container));
    }
  },

  renderNode(node, parentEl) {
    const el = document.createElement('div');
    el.className = 'tree-node';

    const header = document.createElement('div');
    header.className = 'node-header';

    const title = document.createElement('span');
    title.className = 'node-title';
    title.textContent = node.text;

    header.appendChild(title);
    el.appendChild(header);
    parentEl.appendChild(el);
  },

  openModal() {
    const modal = document.getElementById('nodeModal');
    modal.style.display = 'flex';

    document.getElementById('modalCancel').onclick = () => modal.style.display = 'none';
    document.getElementById('modalSave').onclick = () => {
      const text = document.getElementById('nodeTextInput').value.trim();
      if (text) {
        const task = Storage.getTask(this.taskId);
        task.nodes = task.nodes || [];
        task.nodes.push({ id: Date.now().toString(), text, body: '' });
        Storage.updateTask(task);
        this.render();
        modal.style.display = 'none';
        document.getElementById('nodeTextInput').value = '';
      }
    };
  }
};
