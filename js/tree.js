const treeContainer = document.getElementById('treeContainer');
const treeEmpty = document.getElementById('treeEmpty');
const nodeModal = document.getElementById('nodeModal');
const nodeTextInput = document.getElementById('nodeTextInput');
const nodeBodyInput = document.getElementById('nodeBodyInput');
const nodeImgUrl = document.getElementById('nodeImgUrl');
const nodeImgFile = document.getElementById('nodeImgFile');
const nodeImgPreview = document.getElementById('nodeImgPreview');
const nodeImgClear = document.getElementById('nodeImgClear');
const modalSave = document.getElementById('modalSave');
const modalCancel = document.getElementById('modalCancel');

let currentNodes = [];
let editingNodeId = null;
let parentNodeId = null;

function renderTree(nodes, container, taskId) {
  container.innerHTML = '';
  if (nodes.length === 0 && container === treeContainer) {
    treeEmpty.style.display = 'block';
    return;
  }
  if (container === treeContainer) treeEmpty.style.display = 'none';

  nodes.forEach(node => {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'tree-node';

    const header = document.createElement('div');
    header.className = 'node-header';

    const toggle = document.createElement('div');
    toggle.className = `node-toggle ${node.expanded ? 'expanded' : ''}`;
    toggle.textContent = node.children?.length ? '▶' : '•';

    const title = document.createElement('div');
    title.className = 'node-title';
    renderSafeLinks(node.text, title);

    const actions = document.createElement('div');
    actions.className = 'node-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'lg-btn ghost sm';
    addBtn.textContent = '+';
    addBtn.onclick = (e) => { e.stopPropagation(); addNode(node.id); };

    const editBtn = document.createElement('button');
    editBtn.className = 'lg-btn ghost sm';
    editBtn.textContent = '✎';
    editBtn.onclick = (e) => { e.stopPropagation(); editNode(node.id); };

    const delBtn = document.createElement('button');
    delBtn.className = 'lg-btn ghost sm';
    delBtn.textContent = '×';
    delBtn.onclick = (e) => { e.stopPropagation(); deleteNode(node.id); };

    actions.appendChild(addBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    header.appendChild(toggle);
    header.appendChild(title);
    header.appendChild(actions);

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'node-children';
    childrenContainer.style.display = node.expanded ? 'block' : 'none';

    header.onclick = () => {
      node.expanded = !node.expanded;
      saveCurrentNodes();
      renderTree(currentNodes, treeContainer, taskId);
    };

    nodeEl.appendChild(header);

    if (node.body || node.img) {
      const contentEl = document.createElement('div');
      contentEl.className = 'node-content';
      contentEl.style.display = node.expanded ? 'block' : 'none';

      if (node.img) {
        const img = document.createElement('img');
        img.src = node.img;
        img.className = 'node-img';
        contentEl.appendChild(img);
      }

      if (node.body) {
        const bodyText = document.createElement('div');
        bodyText.className = 'node-body-text';
        bodyText.textContent = node.body;
        contentEl.appendChild(bodyText);
      }

      nodeEl.appendChild(contentEl);
    }

    nodeEl.appendChild(childrenContainer);

    container.appendChild(nodeEl);
    if (node.children?.length) {
      renderTree(node.children, childrenContainer, taskId);
    }
  });
}

function renderSafeLinks(text, container) {
  container.innerHTML = '';
  const parts = text.split(/(\[\[.*?\]\])/g);
  parts.forEach(part => {
    if (part.startsWith('[[') && part.endsWith(']]')) {
      const linkText = part.slice(2, -2);
      const span = document.createElement('span');
      span.className = 'node-link';
      span.textContent = linkText;
      container.appendChild(span);
    } else {
      container.appendChild(document.createTextNode(part));
    }
  });
}

function saveCurrentNodes() {
  const id = new URLSearchParams(window.location.search).get('id');
  const task = Storage.getTask(id);
  task.nodes = currentNodes;
  Storage.saveTask(task);
}

function addNode(parentId = null) {
  editingNodeId = null;
  parentNodeId = parentId;
  nodeTextInput.value = '';
  nodeBodyInput.value = '';
  nodeImgUrl.value = '';
  nodeImgFile.value = '';
  nodeImgPreview.src = '';
  nodeImgPreview.style.display = 'none';
  nodeImgClear.style.display = 'none';
  nodeModal.style.display = 'flex';
}

function editNode(id) {
  const node = findNode(currentNodes, id);
  editingNodeId = id;
  nodeTextInput.value = node.text;
  nodeBodyInput.value = node.body || '';
  nodeImgUrl.value = node.img || '';
  if (node.img) {
    nodeImgPreview.src = node.img;
    nodeImgPreview.style.display = 'block';
    nodeImgClear.style.display = 'block';
  } else {
    nodeImgPreview.style.display = 'none';
    nodeImgClear.style.display = 'none';
  }
  nodeModal.style.display = 'flex';
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function deleteNode(id) {
  currentNodes = removeNode(currentNodes, id);
  saveCurrentNodes();
  renderTree(currentNodes, treeContainer);
}

function removeNode(nodes, id) {
  return nodes.filter(n => {
    if (n.id === id) return false;
    if (n.children) n.children = removeNode(n.children, id);
    return true;
  });
}

modalSave?.addEventListener('click', () => {
  const text = nodeTextInput.value.trim();
  if (!text) return;

  if (editingNodeId) {
    const node = findNode(currentNodes, editingNodeId);
    node.text = text;
    node.body = nodeBodyInput.value;
    node.img = nodeImgUrl.value;
  } else {
    const newNode = {
      id: Date.now().toString(),
      text,
      body: nodeBodyInput.value,
      img: nodeImgUrl.value,
      expanded: true,
      children: []
    };
    if (parentNodeId) {
      const parent = findNode(currentNodes, parentNodeId);
      parent.children.push(newNode);
      parent.expanded = true;
    } else {
      currentNodes.push(newNode);
    }
  }

  saveCurrentNodes();
  nodeModal.style.display = 'none';
  renderTree(currentNodes, treeContainer);
});

modalCancel?.addEventListener('click', () => nodeModal.style.display = 'none');

nodeImgFile?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    nodeImgUrl.value = ev.target.result;
    nodeImgPreview.src = ev.target.result;
    nodeImgPreview.style.display = 'block';
    nodeImgClear.style.display = 'block';
  };
  reader.readAsDataURL(file);
});

nodeImgUrl?.addEventListener('input', () => {
  if (nodeImgUrl.value) {
    nodeImgPreview.src = nodeImgUrl.value;
    nodeImgPreview.style.display = 'block';
    nodeImgClear.style.display = 'block';
  } else {
    nodeImgPreview.style.display = 'none';
    nodeImgClear.style.display = 'none';
  }
});

nodeImgClear?.addEventListener('click', () => {
  nodeImgUrl.value = '';
  nodeImgFile.value = '';
  nodeImgPreview.style.display = 'none';
  nodeImgClear.style.display = 'none';
});

window.addNode = addNode;
window.editNode = editNode;
window.deleteNode = deleteNode;
