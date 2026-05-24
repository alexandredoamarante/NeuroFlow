const treeContainer = document.getElementById('treeContainer');
const treeEmpty = document.getElementById('treeEmpty');
const expandAllBtn = document.getElementById('expandAllBtn');
const collapseAllBtn = document.getElementById('collapseAllBtn');
const nodeModal = document.getElementById('nodeModal');
const nodeTextInput = document.getElementById('nodeTextInput');
const nodeBodyInput = document.getElementById('nodeBodyInput');
const nodeImgUrl = document.getElementById('nodeImgUrl');
const nodeImgFile = document.getElementById('nodeImgFile');
const nodeImgPreview = document.getElementById('nodeImgPreview');
const nodeImgClear = document.getElementById('nodeImgClear');
const imageViewer = document.getElementById('imageViewer');
const viewerImg = document.getElementById('viewerImg');
const modalSave = document.getElementById('modalSave');
const modalCancel = document.getElementById('modalCancel');

let currentNodes = [];
let editingNodeId = null;
let parentNodeId = null;

function renderTree(nodes, container, taskId) {
  if (!container) return;
  container.innerHTML = '';
  if (nodes.length === 0 && container === treeContainer) {
    if (treeEmpty) treeEmpty.style.display = 'block';
    return;
  }
  if (container === treeContainer && treeEmpty) treeEmpty.style.display = 'none';

  nodes.forEach(node => {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'tree-node';
    nodeEl.dataset.id = node.id;

    const header = document.createElement('div');
    header.className = 'node-header';

    const toggle = document.createElement('div');
    toggle.className = `node-toggle ${node.expanded ? 'expanded' : ''}`;
    toggle.textContent = node.children?.length ? '▶' : '•';

    const title = document.createElement('div');
    title.className = 'node-title';
    // Node titles do not support greentext/redtext styling
    renderSafeLinks(node.text, title, false);

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
      renderTree(currentNodes, container.closest('#treeContainer') || treeContainer, taskId);
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

        img.onclick = (e) => {
          e.stopPropagation();
          if (viewerImg && imageViewer) {
            viewerImg.src = node.img;
            imageViewer.style.display = 'flex';
          }
        };
        contentEl.appendChild(img);
      }

      if (node.body) {
        const bodyText = document.createElement('div');
        bodyText.className = 'node-body-text';
        renderSafeLinks(node.body, bodyText, true, node.highlights, node.id);
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

const wikiRegex = /^\[\[.*?\]\]$/;
const urlRegex = /^(https?:\/\/[^\s]+|www\.[^\s]+)$/;
const combinedRegex = /(\[\[.*?\]\]|https?:\/\/[^\s]+|www\.[^\s]+)/g;

function renderSafeLinks(text, container, applyColor = true, highlights = [], noteId = null) {
  container.innerHTML = '';
  if (!text) return;

  // Normalize all line endings to \n for consistent offset calculation
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (highlights && highlights.length > 0 && applyColor) {
    renderWithHighlights(normalizedText, container, highlights, noteId);
  } else {
    renderNormal(normalizedText, container, applyColor);
  }
}

function renderNormal(text, container, applyColor, baseOffset = 0) {
  const lines = text.split('\n');
  let currentOffset = baseOffset;

  lines.forEach((line, index) => {
    const isGreen = applyColor && line.startsWith('>');
    const isRed = applyColor && line.startsWith('<');

    let target = container;
    if (isGreen || isRed) {
      const lineSpan = document.createElement('span');
      lineSpan.className = isGreen ? 'greentext' : 'redtext';
      container.appendChild(lineSpan);
      target = lineSpan;
    }

    renderLinksInLine(line, target, currentOffset);
    currentOffset += line.length;

    if (index < lines.length - 1) {
      const br = document.createElement('span');
      br.textContent = '\n';
      br.dataset.sourceStart = currentOffset;
      br.dataset.sourceLength = 1;
      container.appendChild(br);
      currentOffset += 1; // \n
    }
  });
}

function renderLinksInLine(line, container, baseOffset) {
  if (!line) return;
  const parts = line.split(combinedRegex);
  let currentOffset = baseOffset;

  parts.forEach(part => {
    if (!part) return;
    const span = document.createElement('span');
    span.dataset.sourceStart = currentOffset;
    span.dataset.sourceLength = part.length;

    if (wikiRegex.test(part)) {
      const linkText = part.slice(2, -2);
      span.className = 'node-link';
      span.textContent = linkText;
      span.onclick = (e) => {
        e.stopPropagation();
        navigateToNodeByTitle(linkText);
      };
      container.appendChild(span);
    } else if (urlRegex.test(part)) {
      let href = part;
      if (part.startsWith('www.')) href = 'http://' + part;
      const a = document.createElement('a');
      a.href = href;
      a.className = 'node-link';
      a.textContent = part;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.onclick = (e) => e.stopPropagation();
      span.appendChild(a);
      container.appendChild(span);
    } else {
      span.textContent = part;
      container.appendChild(span);
    }
    currentOffset += part.length;
  });
}

function renderWithHighlights(text, container, highlights, noteId) {
  // Sort highlights by start offset
  const sorted = [...highlights].sort((a, b) => a.start - b.start);

  let currentPos = 0;

  sorted.forEach(h => {
    if (h.start > currentPos) {
      const segment = text.substring(currentPos, h.start);
      renderNormal(segment, container, true, currentPos);
    }

    if (h.start >= currentPos) {
      const highlightSpan = document.createElement('span');
      highlightSpan.className = 'note-highlight';
      highlightSpan.dataset.id = h.id;
      highlightSpan.dataset.noteId = noteId;
      if (h.color) {
        highlightSpan.style.backgroundColor = h.color;
        highlightSpan.style.borderBottomColor = h.color.replace('0.4', '0.7');
      }
      // We still want to track source within highlights
      const segment = text.substring(h.start, h.end);
      renderNormal(segment, highlightSpan, true, h.start);

      container.appendChild(highlightSpan);
      currentPos = h.end;
    }
  });

  if (currentPos < text.length) {
    const segment = text.substring(currentPos);
    renderNormal(segment, container, true, currentPos);
  }
}

function navigateToNodeByTitle(title) {
  const target = findNodeByTitle(window.currentNodes, title);
  if (target) {
    // Expand parents and the target itself to show content
    expandParents(window.currentNodes, target.id);
    target.expanded = true;
    saveCurrentNodes();
    renderTree(window.currentNodes, treeContainer);

    // Scroll and highlight
    setTimeout(() => {
      const els = document.querySelectorAll('.node-title');
      for (const el of els) {
        if (el.textContent === title) {
          const nodeEl = el.closest('.tree-node');
          nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          nodeEl.classList.add('highlight-link');
          setTimeout(() => nodeEl.classList.remove('highlight-link'), 2000);
          break;
        }
      }
    }, 100);
  } else {
    alert(`Nota "${title}" não encontrada.`);
  }
}

function findNodeByTitle(nodes, title) {
  for (const n of nodes) {
    if (n.text === title) return n;
    if (n.children) {
      const found = findNodeByTitle(n.children, title);
      if (found) return found;
    }
  }
  return null;
}

function expandParents(nodes, targetId) {
  for (const n of nodes) {
    if (isAncestor(n, targetId)) {
      n.expanded = true;
      if (n.children) expandParents(n.children, targetId);
      return true;
    }
  }
  return false;
}

function isAncestor(node, targetId) {
  if (node.id === targetId) return false;
  if (!node.children) return false;
  for (const child of node.children) {
    if (child.id === targetId || isAncestor(child, targetId)) return true;
  }
  return false;
}

function saveCurrentNodes() {
  const id = new URLSearchParams(window.location.search).get('id');
  const task = Storage.getTask(id);
  if (task) {
    task.nodes = window.currentNodes;
    Storage.saveTask(task);
  }
}

async function compressImage(dataUrl, maxWidth = 1600, maxHeight = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height *= maxWidth / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width *= maxHeight / height;
        height = maxHeight;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      // Quality increased to 0.9 as requested
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = dataUrl;
  });
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
  nodeModal.querySelector('#modalTitle').textContent = 'Nova anotação';
}

function editNode(id) {
  const node = findNode(currentNodes, id);
  editingNodeId = id;
  nodeTextInput.value = node.text || '';
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
  nodeModal.querySelector('#modalTitle').textContent = 'Editar anotação';
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
  window.currentNodes = removeNode(window.currentNodes, id);
  saveCurrentNodes();
  renderTree(window.currentNodes, treeContainer);
}

function removeNode(nodes, id) {
  return nodes.filter(n => {
    if (n.id === id) return false;
    if (n.children) n.children = removeNode(n.children, id);
    return true;
  });
}

modalSave?.addEventListener('click', async () => {
  const text = nodeTextInput.value.trim();
  const body = nodeBodyInput.value.trim();
  const img = nodeImgUrl.value.trim();

  if (!text && !body && !img) return;

  // Sync currentNodes from storage before saving to avoid losing other changes
  const taskId = new URLSearchParams(window.location.search).get('id');
  const task = Storage.getTask(taskId);
  if (task) window.currentNodes = task.nodes || [];

  if (editingNodeId) {
    const node = findNode(window.currentNodes, editingNodeId);
    if (node) {
      node.text = text || '(Sem título)';
      node.body = body;
      node.img = img;
    }
  } else {
    const newNode = {
      id: Date.now().toString(),
      text: text || '(Sem título)',
      body,
      img,
      expanded: true,
      children: []
    };
    if (parentNodeId) {
      const parent = findNode(window.currentNodes, parentNodeId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(newNode);
        parent.expanded = true;
      } else {
        // Fallback to root if parent not found for some reason
        window.currentNodes.push(newNode);
      }
    } else {
      window.currentNodes.push(newNode);
    }
  }

  saveCurrentNodes();
  nodeModal.style.display = 'none';
  renderTree(window.currentNodes, treeContainer);
});

modalCancel?.addEventListener('click', () => nodeModal.style.display = 'none');

nodeImgFile?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const compressed = await compressImage(ev.target.result);
    nodeImgUrl.value = compressed;
    nodeImgPreview.src = compressed;
    nodeImgPreview.style.display = 'block';
    nodeImgClear.style.display = 'block';
  };
  reader.readAsDataURL(file);
});

nodeImgUrl?.addEventListener('input', async () => {
  const val = nodeImgUrl.value.trim();
  if (val) {
    if (val.startsWith('http')) {
      // For URLs, we try to compress if it's a data URL, otherwise we just show it
      // But usually user pastes external URL. We can't compress external URLs easily due to CORS
      nodeImgPreview.src = val;
      nodeImgPreview.style.display = 'block';
      nodeImgClear.style.display = 'block';
    } else if (val.startsWith('data:image')) {
      const compressed = await compressImage(val);
      nodeImgUrl.value = compressed;
      nodeImgPreview.src = compressed;
      nodeImgPreview.style.display = 'block';
      nodeImgClear.style.display = 'block';
    }
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

function setAllExpanded(nodes, state) {
  nodes.forEach(n => {
    n.expanded = state;
    if (n.children) setAllExpanded(n.children, state);
  });
}

expandAllBtn?.addEventListener('click', () => {
  setAllExpanded(window.currentNodes, true);
  saveCurrentNodes();
  renderTree(window.currentNodes, treeContainer);
});

collapseAllBtn?.addEventListener('click', () => {
  setAllExpanded(window.currentNodes, false);
  saveCurrentNodes();
  renderTree(window.currentNodes, treeContainer);
});

imageViewer?.addEventListener('click', (e) => {
  if (e.target === imageViewer || e.target.closest('.viewer-close')) {
    imageViewer.style.display = 'none';
  }
});

window.addNode = addNode;
window.editNode = editNode;
window.deleteNode = deleteNode;
window.renderTree = renderTree;
window.currentNodes = currentNodes;
window.findNode = findNode;
